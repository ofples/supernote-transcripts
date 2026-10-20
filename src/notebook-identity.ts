import type { FolderRule } from "./types";
import { notebookIdentity } from "./shared";
import { relativeToRule } from "./reconcile.mjs";

/** Consolidating sources changes their selection, not ownership of paid results. */
export async function notebookIdentityFor(rule: FolderRule, source: string): Promise<string> {
  const relative = relativeToRule(source, rule);
  const retained = rule.notebookIds?.[relative];
  if (retained !== undefined) {
    if (!/^[a-f0-9]{64}$/.test(retained)) throw Error("The notebook's retained sync identity is invalid. Restore its source settings before updating.");
    return retained;
  }
  return notebookIdentity(rule.sharedId ?? rule.id, relative);
}
