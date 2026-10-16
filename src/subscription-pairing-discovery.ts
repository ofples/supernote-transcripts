import type { SharedIO } from "./shared";
import { pairingAddress } from "./subscription-pairing-crypto.mjs";

const FOLDER = "Supernote Transcripts/Shared Data/Pairing";
const MAX_ADDRESSES = 8;
const MAX_FILES = 64;
const MAX_PROBES = 12;
const PROBE_TIMEOUT_MS = 1_500;
const MAX_LIFETIME_MS = 10 * 60 * 1_000;
const SESSION_ID = /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PairingState = { sid: string; addresses: string[]; expiresAt: number };
export type PairingDiscoveryDescriptor = { v: 1; sid: string; addresses: string[]; expiresAt: number };
export type PairingDiscoveryCandidate = { address: string; sid: string; expiresAt: number };
export type PairingInfoRequest = (url: string) => Promise<{ status: number; json?: unknown }>;

/** Write the public, short-lived LAN locator. Pairing codes and account data are never serialized. */
export async function advertise(io: SharedIO, state: PairingState, deviceId: string, now = Date.now()): Promise<void> {
  if (typeof deviceId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deviceId)) {
    throw new Error("Invalid pairing discovery publisher");
  }
  const descriptor = createDescriptor(state, now);
  await ensureFolder(io, FOLDER);
  const path = `${FOLDER}/${deviceId}.md`;
  const text = JSON.stringify(descriptor);
  if (await io.exists(path)) {
    await io.write(path, text);
  } else {
    try { await io.create(path, text); }
    catch (error) {
      if (!await io.exists(path)) throw error;
      await io.write(path, text);
    }
  }
}

/** Read synced locators and probe only their validated private IPv4 addresses. */
export async function discover(io: SharedIO, request: PairingInfoRequest, now = Date.now()): Promise<PairingDiscoveryCandidate[]> {
  if (!await io.exists(FOLDER)) return [];
  const { files } = await io.list(FOLDER);
  const descriptorFiles = files.filter(path => path.startsWith(`${FOLDER}/`) && !path.slice(FOLDER.length + 1).includes("/")
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.md$/i.test(path.slice(FOLDER.length + 1)))
    .sort().slice(-MAX_FILES);
  const descriptors: PairingDiscoveryDescriptor[] = [];
  for (const path of descriptorFiles) {
    try { descriptors.push(parseDescriptor(await io.read(path), now)); } catch { /* stale or malformed synced records are ignored */ }
  }
  descriptors.sort((a, b) => b.expiresAt - a.expiresAt || a.sid.localeCompare(b.sid));

  const candidates: PairingDiscoveryCandidate[] = [];
  const seen = new Set<string>();
  let probes = 0;
  for (const descriptor of descriptors) {
    for (const address of descriptor.addresses) {
      const key = `${descriptor.sid}|${address}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (++probes > MAX_PROBES) return candidates;
      try {
        const info = await boundedRequest(request, `${address}/info`);
        if (info.status !== 200 || !plainObject(info.json) || info.json.v !== 1 || info.json.sid !== descriptor.sid
          || !Number.isInteger(info.json.expiresIn) || (info.json.expiresIn as number) <= 0
          || (info.json.expiresIn as number) > Math.ceil((descriptor.expiresAt - now) / 1_000) + 5) continue;
        candidates.push({ address, sid: descriptor.sid, expiresAt: Math.min(descriptor.expiresAt, now + (info.json.expiresIn as number) * 1_000) });
      } catch { /* host offline or unreachable */ }
    }
  }
  return candidates;
}

export function createDescriptor(state: PairingState, now = Date.now()): PairingDiscoveryDescriptor {
  if (!state || typeof state.sid !== "string" || !SESSION_ID.test(state.sid) || !Array.isArray(state.addresses)
    || !Number.isFinite(state.expiresAt) || state.expiresAt <= now || state.expiresAt > now + MAX_LIFETIME_MS) {
    throw new Error("Invalid pairing discovery session");
  }
  const addresses = [...new Set(state.addresses.map(value => {
    if (typeof value !== "string") throw new Error("Invalid pairing discovery address");
    const normalized = pairingAddress(value);
    if (normalized !== value.replace(/\/$/, "")) throw new Error("Invalid pairing discovery address");
    return normalized;
  }))];
  if (!addresses.length || addresses.length > MAX_ADDRESSES) throw new Error("Invalid pairing discovery addresses");
  return { v: 1, sid: state.sid, addresses, expiresAt: state.expiresAt };
}

export function parseDescriptor(value: unknown, now = Date.now()): PairingDiscoveryDescriptor {
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { throw new Error("Invalid pairing discovery data"); }
  }
  if (!plainObject(value) || Object.keys(value).sort().join(",") !== "addresses,expiresAt,sid,v"
    || value.v !== 1 || !Number.isFinite(value.expiresAt) || (value.expiresAt as number) <= now
    || (value.expiresAt as number) > now + MAX_LIFETIME_MS + 60_000) {
    throw new Error("Expired or invalid pairing discovery data");
  }
  return createDescriptor(value as unknown as PairingState, now);
}

async function boundedRequest(request: PairingInfoRequest, url: string): Promise<{ status: number; json?: unknown }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      request(url),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Pairing discovery timed out")), PROBE_TIMEOUT_MS); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

async function ensureFolder(io: SharedIO, path: string): Promise<void> {
  const parts = path.split("/");
  for (let i = 1; i <= parts.length; i++) {
    const folder = parts.slice(0, i).join("/");
    if (!await io.exists(folder)) {
      try { await io.mkdir(folder); }
      catch (error) { if (!await io.exists(folder)) throw error; }
    }
  }
}

function plainObject(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
