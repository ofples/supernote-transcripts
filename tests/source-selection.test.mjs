import assert from "node:assert/strict";
import test from "node:test";
import { configuredRecognitionScope, listConfiguredRecognition, listTranscriptionSelection, submitTranscriptionSelection } from "../src/source-selection.mjs";

const folder = {
  id: "journal", enabled: true, source: "C:/Notes", recursive: true,
  exclude: ["Private.note"], output: "Transcripts", profileId: "general",
};
const file = path => ({ path, size: 20, mtime: 1 });

test("an exact recognition selection cannot admit a sibling returned by a reader", async () => {
  const selected = "C:/Notes/Selected.note";
  const scope = configuredRecognitionScope({ source: selected }, [folder], "desktop");
  const reader = {
    async list(path, recursive, exclude) {
      assert.deepEqual([path, recursive, exclude], [selected, false, []]);
      return [file(selected), file("C:/Notes/Sibling.note")];
    },
  };
  const entries = await listConfiguredRecognition(scope, reader, () => [folder],
    path => path === selected ? "Existing/Selected.md" : undefined);
  assert.deepEqual(entries, [{
    ...file(selected), relative: "Selected.note", ruleId: "journal",
    profileId: "general", output: "Existing/Selected.md",
  }]);
});

test("folder scope honors exclusions and more specific owners after listing", async () => {
  const nested = { ...folder, id: "nested", source: "C:/Notes/Nested", exclude: [] };
  const scope = configuredRecognitionScope({ ruleId: folder.id }, [folder], "desktop");
  const reader = {
    async list(path, recursive, exclude) {
      assert.deepEqual([path, recursive, exclude], [folder.source, true, folder.exclude]);
      return ["C:/Notes/Public.note", "C:/Notes/Private.note", "C:/Notes/Nested/Other.note"].map(file);
    },
  };
  const entries = await listConfiguredRecognition(scope, reader, () => [folder, nested], () => undefined);
  assert.deepEqual(entries.map(entry => entry.path), ["C:/Notes/Public.note"]);
});

test("the folder picker plans configured and one-time notebooks without broadening the requested path", async () => {
  const paths = ["C:/Notes/Public.note", "C:/Notes/Private.note", "C:/Elsewhere/Other.note", "C:/Loose/Free.note"];
  const config = { rules: [folder], profiles: [{ id: "general" }] };
  const selected = await listTranscriptionSelection({ path: "C:/Notes", kind: "folder" }, {}, {
    platform: "desktop", config: () => config, defaultOutput: "Saved",
    reader: { async list() { return paths.map(file); } },
    notebook: () => undefined, localId: async source => source,
  });
  assert.deepEqual(selected.map(entry => [entry.path, entry.output, !!entry.oneTime]), [
    ["C:/Notes/Public.note", "Transcripts/Public.md", false],
  ]);
});

test("a second reader format can plan a one-time file without changing the selection operation", async () => {
  const path = "C:/Notes/Field.fixture";
  const config = { rules: [], profiles: [{ id: "general" }] };
  const [entry] = await listTranscriptionSelection({ path, kind: "file" }, {}, {
    platform: "desktop", config: () => config, defaultOutput: "Saved",
    reader: { supportsDocument: source => source.endsWith(".fixture"), async list() { return [file(path)]; } },
    notebook: () => undefined, localId: async source => source,
  });
  assert.deepEqual([entry.path, entry.output, entry.oneTime], [path, "Saved/Field.md", true]);
});

test("a host-independent scoped request gives the queue a resolved run without mutating defaults", async () => {
  const path = "C:/Notes/Field.note";
  const general = {
    id: "general", name: "General", model: "model-a", endpoint: "https://example.invalid/v1/responses",
    prompt: "Default prompt", glossaries: [], preserveFormatting: true, formattingGuide: "Keep columns.",
  };
  const profile = { ...general, id: "field", model: "model-b", preserveFormatting: undefined, formattingGuide: undefined };
  const prompt = { id: "field-prompt", revision: 1 };
  const config = { rules: [], profiles: [general, profile], promptLibrary: [
    { ...prompt, scope: "recognition", name: "Field", text: "Run-only prompt", createdAt: "2026-11-01T00:00:00Z" },
  ] };
  let admitted;
  await submitTranscriptionSelection({ path, kind: "file" }, { profileId: profile.id, prompt }, {
    platform: "desktop", config: () => config, defaultOutput: "Saved",
    reader: { async list() { return [file(path)]; } },
    notebook: () => undefined, localId: async source => source,
    reservedOutput: () => false,
    async admit(entries) { admitted = entries; },
  });
  assert.equal(admitted.length, 1);
  assert.equal(admitted[0].output, "Saved/Field.md");
  assert.deepEqual(admitted[0].run.prompt, prompt);
  assert.equal(admitted[0].run.profile.model, "model-b");
  assert.equal(admitted[0].run.profile.prompt, "Run-only prompt");
  assert.equal(admitted[0].run.profile.formattingGuide, "Keep columns.");
  assert.equal(config.profiles[1].prompt, "Default prompt");
  assert.deepEqual(config.rules, []);
});
