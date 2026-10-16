import { canAdvancePublication, canAdoptPublication, type Receipt } from "./publication";
import { sharedHash, type SharedNotebookCache } from "./shared";
import type { NotebookState, PageDescriptor } from "./types";
import { isEmptyPage } from "./subscription-stream.mjs";

/** Stage raw results proven by the receipt for the exact received output.
 * The caller obtains the receipt through PublicationReceipts.find(outputText).
 * Nothing is committed unless all displayed provenance can be adopted together.
 */
export async function hydratePublicationCache(options: {
  receipt: Receipt | undefined;
  notebookId: string;
  current: PageDescriptor[];
  before: PageDescriptor[];
  local: NotebookState["pages"];
  cache: Pick<SharedNotebookCache, "findResult">;
}): Promise<NotebookState["pages"]> {
  const { receipt, notebookId, current, before, local, cache } = options;
  if (!receipt || receipt.notebookId !== notebookId ||
      !canAdvancePublication(receipt, current, before)) return {};
  const desired = new Map(current.map(page => [page.id, page]));
  const additions: NotebookState["pages"] = {};
  for (const candidate of receipt.candidates ?? [receipt]) {
    if (candidate.notebookId !== notebookId || candidate.textHash !== receipt.textHash) return {};
    for (const published of candidate.results) {
      const page = desired.get(published.id);
      if (!page || published.fingerprint !== page.fingerprint) continue;
      // Current local work remains authoritative even if it conflicts with the receipt.
      if (local[page.id]?.fingerprint === page.fingerprint || additions[page.id]) continue;
      const match = await cache.findResult({ notebookId, pageId: page.id,
        fingerprint: page.fingerprint, recipe: published.recipe });
      const result = [match.chosen, ...match.alternatives].find(result => result &&
        result.notebookId === notebookId && result.pageId === page.id &&
        result.fingerprint === page.fingerprint && result.recipe === published.recipe &&
        result.textHash === published.textHash);
      if (!result || await sharedHash(result.text) !== published.textHash) return {};
      additions[page.id] = { fingerprint: result.fingerprint, text: result.text,
        recipe: result.recipe, number: page.number,
        ...(isEmptyPage(result.text) ? { blank: true } : {}),
        ...(result.recognition ? { recognition: { ...result.recognition } } : {}) };
    }
  }
  return await canAdoptPublication(receipt, current, { ...local, ...additions }) ? additions : {};
}
