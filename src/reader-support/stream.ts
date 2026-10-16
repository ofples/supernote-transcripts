/** The Android asset server advertises Range but has been observed returning the
 * complete file. Always stream the body from byte zero; never trust that header.
 * Requested length-prefixed blocks are retained individually, not the notebook. */
export interface ByteSource {
  size: number;
  scan(
    addresses: number[],
    consume: (address: number, bytes: Uint8Array) => Promise<void> | void,
  ): Promise<void>;
  tail(): Promise<Uint8Array>;
  head(): Promise<Uint8Array>;
}
const MAX_BLOCK = 64 * 1024 * 1024;
export class StreamingFile implements ByteSource {
  constructor(
    public size: number,
    private uri: string,
    private fetcher: typeof fetch = fetch,
    private progress?: (offset: number, size: number) => void,
  ) {}
  private async stream(
    consume: (bytes: Uint8Array, offset: number) => Promise<boolean> | boolean,
  ) {
    const response = await this.fetcher.call(globalThis, this.uri, {
      cache: "no-store",
    });
    if (!response.ok || !response.body)
      throw new Error(
        "This Android file server does not support streaming local notebooks.",
      );
    const reader = response.body.getReader();
    let offset = 0,
      lastReport = 0;
    this.progress?.(0, this.size);
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        const more = await consume(next.value, offset);
        offset += next.value.length;
        if (Date.now() - lastReport >= 250) {
          lastReport = Date.now();
          this.progress?.(offset, this.size);
        }
        if (!more) {
          await reader.cancel();
          return offset;
        }
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    if (offset !== this.size)
      throw new Error("Notebook changed or local file stream ended early.");
    return offset;
  }
  async head() {
    const out = new Uint8Array(24);
    await this.stream((b, o) => {
      if (o < 24) out.set(b.subarray(0, Math.min(b.length, 24 - o)), o);
      return o + b.length < 24;
    });
    return out;
  }
  async tail() {
    const out = new Uint8Array(4);
    await this.stream((b, o) => {
      const start = Math.max(o, this.size - 4),
        end = Math.min(o + b.length, this.size);
      if (end > start)
        out.set(b.subarray(start - o, end - o), start - (this.size - 4));
      return true;
    });
    return out;
  }
  async scan(
    addresses: number[],
    consume: (address: number, bytes: Uint8Array) => Promise<void> | void,
  ) {
    const sorted = [...new Set(addresses.filter((a) => a !== 0))].sort(
      (a, b) => a - b,
    );
    if (!sorted.length) return;
    for (const a of sorted)
      if (!Number.isSafeInteger(a) || a < 24 || a + 4 > this.size)
        throw new Error("Invalid notebook block address.");
    let i = 0,
      header = new Uint8Array(4),
      headerRead = 0,
      content: Uint8Array | null = null,
      read = 0;
    await this.stream(async (chunk, offset) => {
      let pos = 0;
      while (i < sorted.length && pos < chunk.length) {
        const address = sorted[i];
        const target = content ? address + 4 + read : address + headerRead;
        pos = Math.max(pos, target - offset);
        if (pos >= chunk.length) break;
        if (!content) {
          const count = Math.min(4 - headerRead, chunk.length - pos);
          header.set(chunk.subarray(pos, pos + count), headerRead);
          headerRead += count;
          pos += count;
          if (headerRead < 4) break;
          const len = new DataView(header.buffer).getUint32(0, true);
          if (len > MAX_BLOCK || address + 4 + len > this.size)
            throw new Error(
              "Notebook contains an invalid or excessively large individual page block.",
            );
          content = new Uint8Array(len);
        }
        const count = Math.min(content.length - read, chunk.length - pos);
        content.set(chunk.subarray(pos, pos + count), read);
        read += count;
        pos += count;
        if (read === content.length) {
          if (
            i + 1 < sorted.length &&
            sorted[i + 1] < address + 4 + content.length
          )
            throw new Error("Overlapping notebook blocks.");
          await consume(address, content);
          i++;
          headerRead = 0;
          content = null;
          read = 0;
        }
      }
      return i < sorted.length;
    });
    if (i !== sorted.length)
      throw new Error("Notebook block stream ended early.");
  }
}
export function pairs(bytes: Uint8Array): Record<string, string> {
  const result: Record<string, string> = {};
  const text = new TextDecoder().decode(bytes);
  for (const m of text.matchAll(/<([^:<>]+):([^<>]*)>/g)) {
    if (m[1] in result)
      throw new Error(`Ambiguous repeated notebook field: ${m[1]}`);
    result[m[1]] = m[2];
  }
  if (text.includes("<LAYERINFO:") && !("LAYERINFO" in result))
    throw new Error("Malformed notebook layer visibility metadata.");
  return result;
}
export async function sha(bytes: Uint8Array | string) {
  const b = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  return [
    ...new Uint8Array(await crypto.subtle.digest("SHA-256", b as BufferSource)),
  ]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
export function identities(
  ids: (string | undefined)[],
  fingerprints: string[],
) {
  const counts = new Map<string, number>();
  for (const id of ids) if (id) counts.set(id, (counts.get(id) || 0) + 1);
  const used = new Map<string, number>();
  return ids.map((id, i) => {
    if (id && counts.get(id) === 1) return `native:${id}`;
    const base = `content:${fingerprints[i]}`;
    const occurrence = (used.get(base) || 0) + 1;
    used.set(base, occurrence);
    return `${base}:${occurrence}`;
  });
}
