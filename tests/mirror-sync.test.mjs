import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
await build({ entryPoints: ["src/mirror-sync.ts"], outfile: "test-artifacts/mirror-sync-test.mjs", bundle: true, format: "esm", platform: "browser" });
const { reconcileMirror, portableMirrorEqual } = await import("../test-artifacts/mirror-sync-test.mjs");
const make = () => ({ profile: { id: "local", name: "Local", model: "model", endpoint: "https://example.test/v1", prompt: "Transcribe", glossaries: [] }, output: "Transcripts", recursive: true, exclude: [] });

test("Digest category overrides merge, conflict, and return to inheritance without changing recognition", () => {
  const base = make(), local = make(), remote = make();
  remote.digestCategoryName = "Study";
  const inherited = reconcileMirror(local, base, remote);
  assert.equal(inherited.value.digestCategoryName, "Study");
  assert.deepEqual(inherited.value.profile, { ...local.profile, quality: "fast" });
  const uncategorized = { ...make(), digestCategoryName: "" };
  assert.equal(portableMirrorEqual(make(), uncategorized), false);
  assert.equal(reconcileMirror(make(), make(), uncategorized).value.digestCategoryName, "");
  local.digestCategoryName = "Other";
  assert.deepEqual(reconcileMirror(local, base, remote).conflicts, ["digestCategoryName"]);
  const restored = reconcileMirror(make(), remote, remote);
  assert.equal(Object.hasOwn(restored.value, "digestCategoryName"), false);
});
test("new and legacy bindings establish safe baselines without identity churn", () => {
  const local = make(), remote = make();
  remote.profile.id = "remote"; remote.profile.name = "Remote"; remote.profile.quality = "fast";
  assert.equal(reconcileMirror(local, undefined, undefined).publish, true);
  const result = reconcileMirror(local, undefined, remote);
  assert.equal(result.publish, false); assert.deepEqual(result.conflicts, []);
  assert.equal(result.value.profile.id, "local"); assert.ok(result.baseline);
  remote.output = "Other";
  assert.equal(reconcileMirror(local, undefined, remote).conflicts.length, 1);
});
test("local and remote changes merge independently per recipe and source field", () => {
  const base = make(), local = make(), remote = make();
  local.profile.prompt = "Local instructions";
  remote.profile.model = "new-model"; remote.output = "Other";
  const result = reconcileMirror(local, base, remote);
  assert.deepEqual(result.conflicts, []); assert.equal(result.publish, true);
  assert.equal(result.value.profile.prompt, "Local instructions");
  assert.equal(result.value.profile.model, "new-model"); assert.equal(result.value.output, "Other");
  assert.equal(local.output, "Transcripts");
  assert.equal(reconcileMirror(base, base, remote).publish, false);
});
test("formatting preferences and explicit empty guides reconcile as portable profile fields",()=>{
  const base=make(),local=make(),remote=make();
  local.profile.preserveFormatting=false;remote.profile.formattingGuide="remote cues";
  const merged=reconcileMirror(local,base,remote);
  assert.deepEqual(merged.conflicts,[]);assert.equal(merged.value.profile.preserveFormatting,false);
  assert.equal(merged.value.profile.formattingGuide,"remote cues");
  const empty=make();empty.profile.formattingGuide="";
  assert.equal(reconcileMirror(empty,make(),make()).value.profile.formattingGuide,"");
});
test("divergent formatting cue edits conflict and do not advance baseline",()=>{
  const base=make(),local=make(),remote=make();
  base.profile.formattingGuide="base";local.profile.formattingGuide="ours";remote.profile.formattingGuide="theirs";
  const result=reconcileMirror(local,base,remote);
  assert.deepEqual(result.conflicts,["profile.formattingGuide"]);assert.equal(result.value.profile.formattingGuide,"ours");
  assert.equal(result.baseline.profile.formattingGuide,"base");
});
test("divergence preserves original local values and baseline until explicit resolution", () => {
  const base = make(), local = make(), remote = make();
  local.profile.model = "ours"; remote.profile.model = "theirs"; remote.output = "Remote output";
  const result = reconcileMirror(local, base, remote);
  assert.deepEqual(result.conflicts, ["profile.model"]); assert.equal(result.publish, false);
  assert.deepEqual(result.value, local); assert.deepEqual(result.baseline, base);
});
test("matching changes converge, deleted shared definitions require explicit restoration", () => {
  const base = make(), local = make(); local.exclude = ["Private/**"];
  const result = reconcileMirror(local, base, structuredClone(local));
  assert.equal(result.publish, false); assert.deepEqual(result.conflicts, []);
  assert.equal(reconcileMirror(local, base, undefined).conflicts.length, 1);
});
test("automatic check overrides preserve inheritance and merge independently",()=>{
  const base=make(),local=make(),remote=make();
  assert.equal(reconcileMirror(local,base,remote).value.automaticCheck,undefined);
  local.automaticCheck="recent";local.automaticCheckRecentPages=8;
  remote.output="Remote";
  const merged=reconcileMirror(local,base,remote);
  assert.deepEqual(merged.conflicts,[]);assert.equal(merged.value.automaticCheck,"recent");
  assert.equal(merged.value.automaticCheckRecentPages,8);assert.equal(merged.value.output,"Remote");
  assert.equal(portableMirrorEqual(local,{...local}),true);
  assert.equal(portableMirrorEqual(make(),{...make(),automaticCheck:"new"}),false);
});
test("automatic check override conflicts are field-specific and preserve the old baseline",()=>{
  const base=make(),local=make(),remote=make();
  base.automaticCheck="new";local.automaticCheck="all";remote.automaticCheck="recent";
  base.automaticCheckRecentPages=5;local.automaticCheckRecentPages=9;remote.automaticCheckRecentPages=5;
  const result=reconcileMirror(local,base,remote);
  assert.deepEqual(result.conflicts,["automaticCheck"]);
  assert.equal(result.value.automaticCheck,"all");assert.equal(result.value.automaticCheckRecentPages,9);
  assert.equal(result.baseline.automaticCheck,"new");
});
test("retained notebook identity maps merge portably and reject conflicting concurrent changes",()=>{
  const base=make(),local=make(),remote=make();
  base.notebookIds={"One.note":"a".repeat(64)};
  local.notebookIds={...base.notebookIds,"Two.note":"b".repeat(64)};
  remote.notebookIds={...base.notebookIds};
  remote.output="Remote output";
  const merged=reconcileMirror(local,base,remote);
  assert.deepEqual(merged.conflicts,[]);
  assert.deepEqual(merged.value.notebookIds,{"One.note":"a".repeat(64),"Two.note":"b".repeat(64)});
  assert.equal(merged.value.output,"Remote output");
  assert.deepEqual(merged.baseline.notebookIds,merged.value.notebookIds);
  const conflict=make(); conflict.notebookIds={"One.note":"c".repeat(64)};
  const conflicted=reconcileMirror(local,base,conflict);
  assert.deepEqual(conflicted.conflicts,["notebookIds"]);
  assert.deepEqual(conflicted.value,local);
  assert.deepEqual(conflicted.baseline,base);
});
