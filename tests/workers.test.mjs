import test from "node:test";
import assert from "node:assert/strict";
import { runWorkers } from "../src/workers.mjs";
const gate = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
test("workers bound concurrency and drain all items", async () => {
  let active=0, peak=0;
  const saved=[];
  await runWorkers([1,2,3,4,5,6],3,async item=>{
    active++;peak=Math.max(peak,active);
    await Promise.resolve();saved.push(item);active--;
  });
  assert.equal(peak,3);
  assert.deepEqual(saved.sort((a,b)=>a-b),[1,2,3,4,5,6]);
});
test("first failure stops dispatch and waits for every in-flight successful save", async () => {
  const a=gate(),b=gate(),started=[],saved=[];
  let finished=false;
  const task=runWorkers([1,2,3,4],2,async item=>{
    started.push(item);
    if(item===1){await a.promise;throw Error("first failed");}
    await b.promise;saved.push(item);
  }).then(()=>{finished=true;},error=>{finished=true;throw error;});
  const rejected=assert.rejects(task,/first failed/);
  a.resolve();
  await Promise.resolve();await Promise.resolve();
  assert.equal(finished,false);
  assert.deepEqual(started,[1,2]);
  b.resolve();await rejected;
  assert.deepEqual(saved,[2]);
});
test("pause stops new dispatch while current work still reaches durable storage", async () => {
  const pending=gate();let paused=false;
  const started=[],saved=[];
  const task=runWorkers([1,2,3],2,async item=>{
    started.push(item);await pending.promise;saved.push(item);
  },()=>!paused);
  paused=true;pending.resolve();await task;
  assert.deepEqual(started,[1,2]);assert.deepEqual(saved,[1,2]);
});
test("out-of-order saves finish immediately without waiting for earlier requests", async () => {
  const a=gate(),b=gate(),saved=[];
  const task=runWorkers([1,2],2,async item=>{await (item===1?a:b).promise;saved.push(item);});
  b.resolve();await Promise.resolve();await Promise.resolve();
  assert.deepEqual(saved,[2]);
  a.resolve();await task;assert.deepEqual(saved,[2,1]);
});
test("an empty queue never starts work", async () => {
  await runWorkers([],3,async()=>assert.fail("empty queue dispatched"));
});
test("any thrown value stops dispatch and is rethrown after active workers settle", async () => {
  for(const thrown of [undefined,null,false,0,""]){
    const started=[];let caught=false,value;
    try{await runWorkers([1,2,3],1,async item=>{started.push(item);throw thrown;});}
    catch(error){caught=true;value=error;}
    assert.equal(caught,true,`failure ${String(thrown)} must reject`);
    assert.equal(value,thrown);assert.deepEqual(started,[1]);
  }
});
test("a dispatch-guard failure still waits for already active work",async()=>{
  const pending=gate(),saved=[];let checks=0,finished=false;
  const task=runWorkers([1,2,3],2,async item=>{await pending.promise;saved.push(item);},()=>{
    if(++checks===2)throw Error("guard unavailable");return true;
  }).finally(()=>{finished=true;});
  const rejection=assert.rejects(task,/guard unavailable/);
  await Promise.resolve();assert.equal(finished,false);
  pending.resolve();await rejection;assert.deepEqual(saved,[1]);
});
