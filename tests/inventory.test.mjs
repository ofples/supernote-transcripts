import test from "node:test";
import assert from "node:assert/strict";
import { inventoryNotebooks, inventoryView } from "../src/inventory.mjs";
import { pendingPages } from "../src/reconcile.mjs";

const entries = Array.from({ length: 9 }, (_, n) => ({ path: String(n) }));
const descriptor = path => ({ path, revision: "r", pages: [{ id: path, number: 1, fingerprint: path }], width: 1, height: 1 });

for (const [platform, limit] of [["nomad", 2], ["desktop", 4]]) {
  test(`${platform} inventory bounds open handles and visits all notebooks without rendering`, async () => {
    let active = 0, peak = 0, closed = 0;
    const result = await inventoryNotebooks(entries, { async open(path) {
      peak = Math.max(peak, ++active);
      await new Promise(resolve => setImmediate(resolve));
      return { descriptor: descriptor(path), render() { assert.fail("rendered"); },
        readOcr() { assert.fail("read OCR"); }, close() { active--; closed++; } };
    } }, { platform });
    assert.equal(peak, limit); assert.equal(active, 0); assert.equal(closed, 9); assert.equal(result.size, 9);
  });
}

test("one failed notebook does not prevent later inventory and each opened handle closes", async () => {
  const closed = [];
  const result = await inventoryNotebooks(entries, { async open(path) {
    if (path === "1") throw Error("unreadable");
    return { get descriptor() { if (path === "2") throw Error("corrupt"); return descriptor(path); }, close() { closed.push(path); } };
  } });
  assert.equal(result.size, 9); assert.match(result.get("1").error.message, /unreadable/);
  assert.match(result.get("2").error.message, /corrupt/); assert.equal(closed.length, 8);
  assert.ok(result.get("8").descriptor);
});

test("pause drains active opens and stops dispatch within platform bound", async () => {
  let pause = false, release; const gate = new Promise(resolve => { release = resolve; });
  const closed = [];
  const task = inventoryNotebooks(entries, { async open(path) {
    await gate; return { descriptor: descriptor(path), close() { closed.push(path); } };
  } }, { platform: "nomad", mayStart: () => !pause });
  pause = true; release();
  const result = await task;
  assert.equal(result.size, 2); assert.equal(closed.length, 2);
});

test("close errors remain isolated and callbacks run after handles close", async () => {
  let active = 0;
  const result = await inventoryNotebooks([entries[0]], { async open(path) {
    active++;
    return { descriptor: descriptor(path), close() { active--; throw Error("close failed"); } };
  } }, { onResult(_entry, result) {
    assert.equal(active, 0); assert.match(result.error.message, /close failed/);
  } });
  assert.match(result.get("0").error.message, /close failed/);
});

test("retention is opt-in, bounded, and limited to readers with verified fork capability",async()=>{
  const originals=[],closed=[];
  const result=await inventoryNotebooks(entries,{async open(path){
    const opened={descriptor:descriptor(path),render:async()=>"",close(){closed.push(path);}};
    if(Number(path)<6)opened.fork=async()=>({...opened,close(){}});
    originals.push(opened);return opened;
  }},{platform:"nomad",retain:true});
  assert.equal([...result.values()].filter(item=>item.reusable).length,4);
  assert.equal(closed.length,5);
  for(const item of result.values())item.reusable?.close();
  assert.equal(closed.length,9);
});

test("fresh queue projection preserves publication baseline and matches reused fingerprints", () => {
  const oldPage = { id: "old", number: 1, fingerprint: "same" };
  const state = { desired: [oldPage], order: ["old"], pages: { old: { ...oldPage, text: "saved", recipe: "previous-model" } },
    publishedPages: [oldPage], publishedHash: "published", revision: "old-revision" };
  const original = structuredClone(state);
  const view = inventoryView(state, { pages: [{ id: "renamed", number: 1, fingerprint: "same" }, { id: "new", number: 2, fingerprint: "new" }] });
  assert.deepEqual(pendingPages(view).map(p => p.id), ["new"]);
  assert.equal(view.pages.renamed.recipe, "previous-model");
  assert.deepEqual(state, original); assert.equal(view.revision, "old-revision");
  assert.equal(view.publishedPages, state.publishedPages);
  assert.deepEqual(view.priorityPages, ["renamed", "new"]);
});

test("inventory projection preserves explicit retry selections and existing priorities", () => {
  const state = { desired: [{ id: "a", number: 1, fingerprint: "old" }], pages: {}, order: ["a"],
    priorityPages: ["a", "removed"], forcePending: ["a", "removed"] };
  const view = inventoryView(state, { pages: [{ id: "a", number: 1, fingerprint: "changed" }, { id: "b", number: 2, fingerprint: "new" }] });
  assert.deepEqual(view.priorityPages, ["a", "b"]);
  assert.deepEqual(view.forcePending, ["a", "removed"]);
  assert.deepEqual(state.priorityPages, ["a", "removed"]);
});
