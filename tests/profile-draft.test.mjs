import test from "node:test";
import assert from "node:assert/strict";
import { mergeProfileDrafts } from "../src/profile-draft.mjs";
const profile = (id="general") => ({ id, name:id, model:"model",endpoint:"https://example.test",prompt:"original",glossaries:["Terms.md"],quality:"fast" });
test("unchanged open Settings draft preserves arrived profiles and remote edits",()=>{
  const base=[profile()],draft=structuredClone(base),current=[{...profile(),prompt:"remote"},profile("arrived")];
  assert.deepEqual(mergeProfileDrafts(current,base,draft),current);
});
test("user field edits merge with independent current changes and identical concurrent edits",()=>{
  const base=[profile()],draft=structuredClone(base),current=structuredClone(base);
  draft[0].prompt="our instructions";current[0].model="remote model";
  const merged=mergeProfileDrafts(current,base,draft);
  assert.equal(merged[0].prompt,"our instructions");assert.equal(merged[0].model,"remote model");
  current[0].prompt=draft[0].prompt;assert.deepEqual(mergeProfileDrafts(current,base,draft),merged);
});
test("formatting preference and cue edits merge independently and preserve explicit empty cues",()=>{
  const base=[{...profile(),preserveFormatting:false,formattingGuide:"base cues"}],draft=structuredClone(base),current=structuredClone(base);
  draft[0].preserveFormatting=true;current[0].formattingGuide="remote cues";
  const merged=mergeProfileDrafts(current,base,draft);
  assert.equal(merged[0].preserveFormatting,true);assert.equal(merged[0].formattingGuide,"remote cues");
  draft[0].formattingGuide="";
  assert.equal(mergeProfileDrafts(base,base,draft)[0].formattingGuide,"");
});
test("concurrent formatting cue conflicts are reported and clearing an override deletes it",()=>{
  const base=[profile()],draft=structuredClone(base),current=structuredClone(base);
  draft[0].formattingGuide="ours";current[0].formattingGuide="theirs";
  assert.throws(()=>mergeProfileDrafts(current,base,draft),/formattingGuide/);
  const overridden=[{...profile(),formattingGuide:"custom"}],clear=[profile()];
  assert.equal(Object.hasOwn(mergeProfileDrafts(overridden,overridden,clear)[0],"formattingGuide"),false);
});
test("divergent edits throw without changing any current or draft profiles",()=>{
  const base=[profile()],draft=structuredClone(base),current=structuredClone(base);
  draft[0].prompt="ours";draft[0].glossaries=["Our terms.md"];current[0].prompt="theirs";
  const snapshot=structuredClone({base,draft,current});
  assert.throws(()=>mergeProfileDrafts(current,base,draft),/general.*prompt/);
  assert.deepEqual({base,draft,current},snapshot);
});
test("removed changed profiles error, untouched removals stay removed and omitted drafts do not delete",()=>{
  const base=[profile()],draft=structuredClone(base);
  assert.deepEqual(mergeProfileDrafts([],base,draft),[]);
  draft[0].model="changed";assert.throws(()=>mergeProfileDrafts([],base,draft),/removed/);
  assert.deepEqual(mergeProfileDrafts(base,base,[]),base);
});
test("returned profiles and glossary lists are independent clones, including added drafts",()=>{
  const current=[profile()],base=structuredClone(current),draft=[...structuredClone(base),profile("new")];
  const merged=mergeProfileDrafts(current,base,draft);
  merged[0].glossaries.push("Other.md");merged[1].glossaries.push("New.md");merged[0].name="changed";
  assert.deepEqual(current,[profile()]);assert.deepEqual(base,[profile()]);assert.deepEqual(draft[1],profile("new"));
});
test("new identity collisions and duplicate identities fail instead of overwriting arrived profiles",()=>{
  assert.throws(()=>mergeProfileDrafts([profile("new")],[],[{...profile("new"),prompt:"ours"}]),/same identity/);
  assert.throws(()=>mergeProfileDrafts([profile(),profile()],[],[]),/Duplicate/);
});
