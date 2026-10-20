import { reconcilePages } from "./reconcile.mjs";

/** Read metadata for the entire selection before recognition starts. Only a
 * bounded number of notebooks are open; no images or OCR are requested here.
 * The caller owns persistence and decides how to display individual failures.
 * @param {any[]} entries
 * @param {any} reader
 * @param {{platform?: string, retain?: boolean, mayStart?: () => boolean, onResult?: (entry: any, result: any) => void | Promise<void>}} options
 */
export async function inventoryNotebooks(entries, reader, {
  platform = "desktop", retain = false, mayStart = () => true, onResult = () => {},
} = {}) {
  const results = new Map();
  const maxRetained = retain ? (platform === "nomad" ? 4 : 8) : 0;
  let retainedCount = 0;
  let cursor = 0;
  const worker = async () => {
    while (cursor < entries.length && mayStart()) {
      const entry = entries[cursor++];
      let opened, result;
      try {
        opened = await reader.open(entry.path);
        // Detach the descriptor before closing the underlying byte source.
        const d = opened.descriptor;
        result = { descriptor: { ...d, pages: d.pages.map(p => ({ ...p })) } };
        if (retainedCount < maxRetained && typeof opened.fork === "function") {
          result.reusable = opened;
          opened = undefined;
          retainedCount++;
        }
      } catch (error) {
        result = { error };
      } finally {
        if (opened) {
          try { await opened.close(); }
          catch (error) { result = { error }; }
        }
      }
      results.set(entry.path, result);
      await onResult(entry, result);
    }
  };
  // A callback failure must still drain every in-flight open/close operation.
  const settled = await Promise.allSettled(Array.from({
    length: Math.min(entries.length, platform === "nomad" ? 2 : 4),
  }, worker));
  const failed = settled.find(r => r.status === "rejected");
  if (failed) {
    await Promise.allSettled([...results.values()].map(result => result.reusable?.close()));
    throw failed.reason;
  }
  return results;
}

/** Presentation-only view. Never persist this projection: recognition needs
 * the previous desired pages for publication provenance and additions.
 * Recipe/model changes do not invalidate otherwise matching transcriptions.
 */
export function inventoryView(state, descriptor) {
  if (!descriptor) return state;
  const reconciled = reconcilePages(state.pages, descriptor.pages);
  const known = new Set(state.desired.map(page => page.id));
  const additions = known.size ? descriptor.pages.filter(page => !known.has(page.id)).map(page => page.id) : [];
  const priorityPages = [...new Set([...(state.priorityPages ?? []), ...additions])]
    .filter(id => reconciled.order.includes(id));
  return { ...state, desired: descriptor.pages, order: reconciled.order, pages: reconciled.pages, priorityPages };
}
