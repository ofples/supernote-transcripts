import type { ConfigV1, Store } from "./types";
import { ruleFor } from "./reconcile.mjs";

export interface DigestPreferences { categoryName?: string }

/** Undefined inherits Reader; an explicit empty string selects Uncategorized. */
export function validateDigestCategoryName(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > 128 || /[\u0000-\u001f\u007f-\u009f]/u.test(value))
    throw Error("Use an existing Digest category name of at most 128 characters.");
  return value.trim();
}

/** Bind by the actual published file, never by a matching output-folder prefix. */
export function digestPreferencesForOutput(config: ConfigV1, store: Store, outputPath: string): DigestPreferences | null {
  if (typeof outputPath !== "string" || !outputPath || /[\u0000-\u001f\u007f-\u009f]/u.test(outputPath))
    throw Error("The Digest source document is unavailable.");
  const matches = Object.values(store.notebooks).filter(state => (state.outputOverride ?? state.output) === outputPath);
  if (!matches.length) return null;
  if (matches.length !== 1) throw Error("More than one notebook owns this transcript. Resolve its source before creating a Digest.");
  const state = matches[0];
  const rule = config.rules.find(item => item.id === state.ruleId) ?? ruleFor(state.source, config.rules);
  if (!rule) throw Error("The source settings for this transcript are unavailable.");
  const categoryName = validateDigestCategoryName(rule.digestCategoryName);
  return categoryName === undefined ? null : { categoryName };
}
