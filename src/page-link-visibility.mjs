const isPath = (value) => typeof value === "string" && value.length > 0 &&
  !value.startsWith("/") && !value.includes("\\") && !/[\u0000-\u001f]/.test(value) &&
  value.split("/").every(part => part && part !== "." && part !== ".." && !part.includes(":"));

function readOverrides(storage, key) {
  try {
    const raw = storage.getItem(key);
    if (!raw) return {};
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== "object" || Array.isArray(saved) || saved.version !== 1 ||
        !saved.overrides || typeof saved.overrides !== "object" || Array.isArray(saved.overrides)) return {};
    return Object.fromEntries(Object.entries(saved.overrides).filter(([path, value]) => isPath(path) && typeof value === "boolean"));
  } catch {
    return {};
  }
}

/** Store sparse per-document page-link visibility without touching note Markdown. */
export function createPageLinkVisibility(storage, key, globalEnabled = () => true) {
  if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function" || typeof key !== "string" || !key) {
    throw new TypeError("Page-link visibility requires storage and a storage key.");
  }
  const overrides = readOverrides(storage, key);
  const persist = () => {
    try {
      if (Object.keys(overrides).length) storage.setItem(key, JSON.stringify({ version: 1, overrides }));
      else storage.removeItem?.(key);
      return true;
    } catch {
      return false;
    }
  };
  const enabled = (sourcePath) => {
    if (isPath(sourcePath) && Object.prototype.hasOwnProperty.call(overrides, sourcePath)) return overrides[sourcePath];
    if (sourcePath !== undefined) return Boolean(globalEnabled());
    return Boolean(globalEnabled()) || Object.values(overrides).some(Boolean);
  };
  return {
    enabled,
    hasOverride: (sourcePath) => isPath(sourcePath) && Object.prototype.hasOwnProperty.call(overrides, sourcePath),
    setEnabled(sourcePath, visible) {
      if (!isPath(sourcePath) || typeof visible !== "boolean") return false;
      overrides[sourcePath] = visible;
      return persist();
    },
    clear(sourcePath) {
      if (!isPath(sourcePath) || !Object.prototype.hasOwnProperty.call(overrides, sourcePath)) return false;
      delete overrides[sourcePath];
      return persist();
    },
    rename(oldPath, newPath) {
      if (!isPath(oldPath) || !isPath(newPath) || !Object.prototype.hasOwnProperty.call(overrides, oldPath)) return false;
      if (oldPath === newPath) return true;
      overrides[newPath] = overrides[oldPath];
      delete overrides[oldPath];
      return persist();
    },
    deletePath(sourcePath) { return this.clear(sourcePath); },
    clearAll() {
      for (const path of Object.keys(overrides)) delete overrides[path];
      return persist();
    },
  };
}
