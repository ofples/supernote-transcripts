/** Supernote 0.7.1 LAYERINFO uses JSON objects with # separators. Parse explicit
 * flags strictly: a malformed flag must never make private hidden ink visible. */
export function visibleSequence(
  content: string | undefined,
  sequence: string[],
) {
  if (content === undefined) return sequence;
  let json = "";
  let lastString: string | undefined;
  const objects: Set<string>[] = [];
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (char === '"') {
      const start = i;
      for (i++; i < content.length; i++) {
        if (content[i] === "\\") i++;
        else if (content[i] === '"') break;
      }
      if (i >= content.length)
        throw new Error("Malformed notebook layer visibility.");
      const token = content.slice(start, i + 1);
      lastString = JSON.parse(token);
      json += token;
    } else if (char === "#") {
      const keys = objects[objects.length - 1];
      if (!keys || lastString === undefined || keys.has(lastString))
        throw new Error("Ambiguous notebook layer visibility fields.");
      keys.add(lastString);
      lastString = undefined;
      json += ":";
    } else {
      if (char === ":")
        throw new Error("Unsupported notebook layer visibility syntax.");
      if (char === "{") objects.push(new Set());
      if (char === "}") objects.pop();
      if (!/\s/.test(char)) lastString = undefined;
      json += char;
    }
  }
  let records: unknown;
  try {
    records = JSON.parse(json);
  } catch {
    throw new Error("Malformed notebook layer visibility.");
  }
  if (!Array.isArray(records))
    throw new Error("Malformed notebook layer visibility.");
  const flags = new Map<string, boolean>();
  const names = ["BGLAYER", "MAINLAYER", "LAYER1", "LAYER2", "LAYER3"];
  for (const record of records) {
    if (
      !record ||
      typeof record !== "object" ||
      Array.isArray(record) ||
      !Number.isInteger(record.layerId) ||
      record.layerId < -1 ||
      record.layerId > 3 ||
      typeof record.isVisible !== "boolean" ||
      typeof record.isDeleted !== "boolean"
    )
      throw new Error("Malformed notebook layer visibility flags.");
    const name = names[record.layerId + 1];
    if (flags.has(name))
      throw new Error("Ambiguous notebook layer visibility entries.");
    flags.set(name, record.isVisible && !record.isDeleted);
  }
  for (const name of sequence)
    if (!flags.has(name))
      throw new Error("Notebook layer visibility is incomplete.");
  return sequence.filter((name) => flags.get(name));
}
