import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const built = await build({ entryPoints: ["src/storage-paths.ts"], bundle: true, platform: "node", format: "esm", write: false });
const paths = await import("data:text/javascript;base64," + Buffer.from(built.outputFiles[0].text).toString("base64"));

test("storage paths separate operational data from Markdown transcripts", () => {
  assert.equal(paths.DATA_ROOT, "_supernote");
  assert.equal(paths.SHARED_ROOT, "_supernote/Shared Data");
  assert.equal(paths.HISTORY_ROOT, "_supernote/History");
  assert.equal(paths.ARCHIVE_ROOT, "_supernote/Archive");
  assert.equal(paths.GLOSSARY_ROOT, "_supernote/Glossaries");
  assert.equal(paths.TRANSCRIPTS_ROOT, "Supernote Transcripts");
});

test("known legacy paths map while custom destinations remain unchanged", () => {
  assert.equal(paths.migrateVaultPath("Supernote Transcripts/Shared Data/Pairing/device.md"), "_supernote/Shared Data/Pairing/device.md");
  assert.equal(paths.migrateVaultPath("Supernote Transcripts/History/a.md"), "_supernote/History/a.md");
  assert.equal(paths.migrateVaultPath("Supernote Transcripts/Archive/a.md"), "_supernote/Archive/a.md");
  assert.equal(paths.migrateVaultPath("Supernote Transcripts/Glossaries/a.txt"), "_supernote/Glossaries/a.txt");
  assert.equal(paths.migrateVaultPath("Supernote Transcripts/Transcripts/a.md"), "Supernote Transcripts/a.md");
  assert.equal(paths.migrateVaultPath("My Output/a.md"), "My Output/a.md");
});

test("operational data roots include legacy subtrees but exclude transcript outputs", () => {
  for (const path of ["_supernote", "_supernote/Shared Data/a.md", "Supernote Transcripts/History/a.md", "Supernote Transcripts/Archive/a.md", "Supernote Transcripts/Glossaries/a.txt"])
    assert.equal(paths.isDataPath(path), true, path);
  for (const path of ["Supernote Transcripts", "Supernote Transcripts/a.md", "My Output/a.md"])
    assert.equal(paths.isDataPath(path), false, path);
});

test("configured support paths reject hidden, reserved and escaping folder names",()=>{
  for(const path of [".supernote","Data/.hidden","../Cache","C:/Data","/Data","Data//Cache","CON","NUL.txt","Data /Cache","Notes.md"])
    assert.throws(()=>paths.validateSupportFolder(path),undefined,path);
  assert.equal(paths.validateSupportFolder("System/Supernote data"),"System/Supernote data");
  assert.equal(paths.isDataPath("System/Supernote data/Shared Data/a.md","System/Supernote data"),true);
  assert.equal(paths.isDataPath("System/Supernote database/a.md","System/Supernote data"),false);
});
