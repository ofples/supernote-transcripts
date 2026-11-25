import test from "node:test";
import assert from "node:assert/strict";
import {
  browserBreadcrumbs,
  browserEntryType,
  initialBrowserPath,
  isBrowserRoot,
  joinBrowserPath,
  normalizeBrowserPath,
  parentBrowserPath,
} from "../src/browser.mjs";

test("desktop browser preserves drive roots and joins children without duplicate slashes", () => {
  assert.equal(normalizeBrowserPath("c:\\"), "C:/");
  assert.equal(joinBrowserPath("C:/", "Users"), "C:/Users");
  assert.equal(parentBrowserPath("C:/Users"), "C:/");
  assert.equal(parentBrowserPath("C:/"), "C:/");
  assert.equal(isBrowserRoot("C:/"), true);
});

test("UNC and POSIX breadcrumb navigation stay within valid roots", () => {
  assert.deepEqual(browserBreadcrumbs("//server/share/Notes/Satsang"), [
    { path: "//server/share", label: "//server/share" },
    { path: "//server/share/Notes", label: "Notes" },
    { path: "//server/share/Notes/Satsang", label: "Satsang" },
  ]);
  assert.equal(parentBrowserPath("//server/share/Notes"), "//server/share");
  assert.equal(parentBrowserPath("//server/share"), "//server/share");
  assert.deepEqual(browserBreadcrumbs("/home/user/Notes"), [
    { path: "/", label: "/" },
    { path: "/home", label: "home" },
    { path: "/home/user", label: "user" },
    { path: "/home/user/Notes", label: "Notes" },
  ]);
});

test("desktop browser starts beside the existing source, then falls back to the vault", () => {
  assert.equal(
    initialBrowserPath(["C:/Notes/Supernote/Reflection.note"], "C:/Vault"),
    "C:/Notes/Supernote",
  );
  assert.equal(initialBrowserPath([], "C:/Vault"), "C:/Vault");
  assert.equal(initialBrowserPath([], undefined), "/");
});

test("absolute browser paths reject relative and traversal input", () => {
  assert.throws(() => normalizeBrowserPath("Notes/Supernote"), /absolute/);
  assert.throws(() => normalizeBrowserPath("C:/Notes/../Secrets"), /\.\./);
});

test("desktop browser uses Dirent methods and only lists folders or regular .note files", () => {
  const entry = (name, directory, file) => ({
    name,
    isDirectory: () => directory,
    isFile: () => file,
  });
  assert.equal(browserEntryType(entry("Notes", true, false)), "directory");
  assert.equal(browserEntryType(entry("Reflection.note", false, true)), "file");
  assert.equal(browserEntryType(entry("archive.zip", false, true)), undefined);
  assert.equal(browserEntryType(entry("link.note", false, false)), undefined);
  assert.equal(browserEntryType(entry(".hidden.note", false, true)), undefined);
});

test("desktop browser shows linked folders and notebooks by their targets and hides dangling links", async () => {
  const { resolveBrowserEntry } = await import("../src/browser.mjs");
  const link = (name) => ({ name, isDirectory: () => false, isFile: () => false, isSymbolicLink: () => true });
  const stats = {
    "/Users/me/Google Drive": { isDirectory: () => true, isFile: () => false },
    "/Users/me/linked.note": { isDirectory: () => false, isFile: () => true },
  };
  const stat = async (path) => { if (!stats[path]) throw Object.assign(Error("missing"), { code: "ENOENT" }); return stats[path]; };
  assert.equal(browserEntryType(await resolveBrowserEntry(link("Google Drive"), "/Users/me/Google Drive", stat)), "directory");
  assert.equal(browserEntryType(await resolveBrowserEntry(link("linked.note"), "/Users/me/linked.note", stat)), "file");
  assert.equal(await resolveBrowserEntry(link("gone"), "/Users/me/gone", stat), undefined);
  const plain = { name: "Notes", isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false };
  assert.equal(await resolveBrowserEntry(plain, "/Users/me/Notes", stat), plain);
  assert.equal(await resolveBrowserEntry("Notes", "/x/Notes", stat), "Notes");
});
