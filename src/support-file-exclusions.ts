import { DATA_ROOT } from "./storage-paths";

type Suggestion = { file?: { path?: unknown }; item?: { file?: { path?: unknown } } };

/** Match only the reserved support-data directory and its descendants. */
export function isSupportFilePath(path: unknown, root = DATA_ROOT): boolean {
  if (typeof path !== "string" || typeof root !== "string" || !root.trim()) return false;
  const normalizedPath = path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/{2,}/g, "/").toLowerCase();
  const normalizedRoot = root.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").replace(/\/{2,}/g, "/").toLowerCase();
  return !!normalizedRoot && (normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`));
}

function suggestionFilePath(value: unknown): unknown {
  if (!value || typeof value !== "object") return undefined;
  const suggestion = value as Suggestion;
  return suggestion.file?.path ?? suggestion.item?.file?.path;
}

/** Keep non-file, unresolved and user-owned suggestions untouched. */
export function filterSupportFileSuggestions<T>(suggestions: T[], root = DATA_ROOT): T[] {
  return suggestions.filter((suggestion) => !isSupportFilePath(suggestionFilePath(suggestion), root));
}

export interface SupportExclusionPlugin {
  app: any;
  register(callback: () => void): void;
}
export type SupportExclusionPreferences = () => { root: string; exclude: boolean };

/**
 * Exclude reserved files from native Quick Switcher results without changing
 * Vault enumeration. The core switcher exposes its closed-over modal constructor
 * as `QuickSwitcherModal`, so patching that constructor's prototype also covers
 * callbacks that were bound before this plugin loaded.
 */
export function installSupportFileExclusions(plugin: SupportExclusionPlugin, getPreferences?: SupportExclusionPreferences): (() => void) | undefined {
  const instance = plugin.app?.internalPlugins?.getPluginById?.("switcher")?.instance;
  const NativeModal = instance?.QuickSwitcherModal;
  const prototype = typeof NativeModal === "function" ? NativeModal.prototype : undefined;
  if (!prototype || typeof prototype.getSuggestions !== "function") return undefined;

  const originalDescriptor = Object.getOwnPropertyDescriptor(prototype, "getSuggestions");
  const original = prototype.getSuggestions;
  const wrapper = function (this: unknown, ...args: unknown[]) {
    const prefs = getPreferences?.() ?? { root: DATA_ROOT, exclude: true };
    const filter = (value: unknown) => {
      if (!Array.isArray(value)) return value;
      const filtered = filterSupportFileSuggestions(value, prefs.exclude ? prefs.root : "");
      return filtered.filter((suggestion: unknown) => {
        const path = suggestionFilePath(suggestion);
        if (typeof path !== "string") return true;
        const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
        return normalized !== "_supernote-storage.md";
      });
    };
    const result = original.apply(this, args);
    if (result && typeof (result as any).then === "function") {
      return Promise.resolve(result).then(filter);
    }
    return filter(result);
  };
  try {
    Object.defineProperty(prototype, "getSuggestions", {
      configurable: true,
      enumerable: originalDescriptor?.enumerable ?? false,
      writable: true,
      value: wrapper,
    });
    if (prototype.getSuggestions !== wrapper) return undefined;
  } catch {
    return undefined;
  }
  const restore = () => {
    if (prototype.getSuggestions !== wrapper) return;
    try {
      if (originalDescriptor) Object.defineProperty(prototype, "getSuggestions", originalDescriptor);
      else delete prototype.getSuggestions;
    } catch { /* Preserve a core or third-party replacement if restoration is locked. */ }
  };
  plugin.register(restore);
  return restore;
}
