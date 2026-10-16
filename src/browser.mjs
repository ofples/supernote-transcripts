const DRIVE_ROOT = /^[A-Za-z]:\/$/;
const UNC_SHARE_ROOT = /^\/\/[^/]+\/[^/]+\/?$/;

export function normalizeBrowserPath(value) {
  if (!value || /[\u0000-\u001f]/.test(value))
    throw new Error("Enter an absolute folder path.");
  let path = value.replace(/\\/g, "/");
  if (/^[A-Za-z]:$/.test(path)) path += "/";
  if (!path.startsWith("/") && !/^[A-Za-z]:\//.test(path))
    throw new Error("Enter an absolute folder path.");
  if (path.split("/").some((part) => part === "." || part === ".."))
    throw new Error("Folder paths cannot contain . or .. segments.");
  if (path.startsWith("//")) {
    if (!/^\/\/[^/:?*<>|]+\/[^/:?*<>|]+(?:\/|$)/.test(path))
      throw new Error("Enter a network share path such as //server/share.");
  }
  if (DRIVE_ROOT.test(path)) return `${path[0].toUpperCase()}:/`;
  path = path.replace(/\/+$/, "");
  return path || "/";
}

export function joinBrowserPath(parent, name) {
  const root = normalizeBrowserPath(parent);
  const child = String(name).replace(/\\/g, "/");
  if (!child || child === "." || child === ".." || child.includes("/"))
    throw new Error("Invalid folder entry.");
  return root.endsWith("/") ? `${root}${child}` : `${root}/${child}`;
}

export function isBrowserRoot(path) {
  const normalized = normalizeBrowserPath(path);
  return normalized === "/" || DRIVE_ROOT.test(normalized) || UNC_SHARE_ROOT.test(normalized);
}

export function parentBrowserPath(path) {
  const normalized = normalizeBrowserPath(path);
  if (normalized === "/" || DRIVE_ROOT.test(normalized) || UNC_SHARE_ROOT.test(normalized))
    return normalized;
  const index = normalized.lastIndexOf("/");
  if (index < 0) return normalized;
  const parent = normalized.slice(0, index) || "/";
  if (/^[A-Za-z]:$/.test(parent)) return `${parent[0].toUpperCase()}:/`;
  if (normalized.startsWith("//") && /^\/\/[^/]+$/.test(parent))
    return normalized;
  return parent;
}

export function browserBreadcrumbs(path) {
  const normalized = normalizeBrowserPath(path);
  if (normalized === "/") return [{ path: "/", label: "/" }];
  if (/^[A-Za-z]:\/$/.test(normalized))
    return [{ path: normalized, label: normalized }];
  if (normalized.startsWith("//")) {
    const parts = normalized.slice(2).split("/").filter(Boolean);
    const share = `//${parts.slice(0, 2).join("/")}`;
    const crumbs = [{ path: share, label: share }];
    for (let index = 2; index < parts.length; index++)
      crumbs.push({
        path: `${crumbs.at(-1).path}/${parts[index]}`,
        label: parts[index],
      });
    return crumbs;
  }
  const parts = normalized.split("/").filter(Boolean);
  const drive = /^[A-Za-z]:/.exec(parts[0] ?? "")?.[0];
  const crumbs = drive
    ? [{ path: `${drive}/`, label: `${drive}/` }]
    : [{ path: "/", label: "/" }];
  for (const part of drive ? parts.slice(1) : parts) {
    const previous = crumbs.at(-1).path;
    crumbs.push({
      path: previous.endsWith("/") ? `${previous}${part}` : `${previous}/${part}`,
      label: part,
    });
  }
  return crumbs;
}

export function initialBrowserPath(existingSources, vaultPath) {
  const source = existingSources.find((item) => item && typeof item === "string");
  if (source) return parentBrowserPath(source);
  if (vaultPath && typeof vaultPath === "string")
    return normalizeBrowserPath(vaultPath);
  return "/";
}

export function browserEntryType(entry, fallbackType) {
  const name = typeof entry === "string" ? entry : entry?.name;
  if (!name || name.startsWith(".")) return undefined;
  if (typeof entry?.isDirectory === "function") {
    if (entry.isDirectory()) return "directory";
    if (entry.isFile() && name.toLowerCase().endsWith(".note")) return "file";
    return undefined;
  }
  if (fallbackType === "directory") return "directory";
  if (name.toLowerCase().endsWith(".note")) return "file";
  return undefined;
}
