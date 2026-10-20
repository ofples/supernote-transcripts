import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
const directory=fileURLToPath(new URL("../",import.meta.url));
await build({entryPoints:[`${directory}src/automatic-check.ts`],outfile:`${directory}test-artifacts/automatic-check-test.mjs`,bundle:true,format:"esm",platform:"browser"});
const {automaticCheckOptions,validateAutomaticCheck,descriptorCheckMode,automaticPageIds,automaticPolicyKey}=await import("../test-artifacts/automatic-check-test.mjs");
const config=(values={})=>({version:1,profiles:[],rules:[],intervalMinutes:5,batchPages:2,...values});
const rule=(values={})=>({id:"rule",enabled:true,source:"/storage/emulated/0/Note/Reflections",output:"Mirror",recursive:true,exclude:[],profileId:"general",...values});

test("automatic checks default to new pages and five recent pages while retaining the prior descriptor",()=>{
  const previous=[{id:"old-id",number:1,fingerprint:"old"}],state={desired:previous};
  const options=automaticCheckOptions(config(),rule(),state);
  assert.deepEqual(options,{mode:"new",recentPages:5,previous});
  assert.notEqual(options.previous,previous);
  assert.notEqual(options.previous[0],previous[0]);
});

test("source automatic-check overrides inherit each omitted value from global settings",()=>{
  const global=config({automaticCheck:"recent",automaticCheckRecentPages:12});
  assert.deepEqual(automaticCheckOptions(global,rule()),{mode:"recent",recentPages:12,previous:[]});
  assert.deepEqual(automaticCheckOptions(global,rule({automaticCheck:"all"})),{mode:"all",recentPages:12,previous:[]});
  assert.deepEqual(automaticCheckOptions(global,rule({automaticCheckRecentPages:3})),{mode:"recent",recentPages:3,previous:[]});
  assert.deepEqual(automaticCheckOptions(global,rule({automaticCheck:"new",automaticCheckRecentPages:1})),{mode:"new",recentPages:1,previous:[]});
});

test("automatic-check validation rejects unknown modes and recent page counts outside one to one hundred",()=>{
  for(const value of ["never","NEW",null])assert.throws(()=>validateAutomaticCheck({automaticCheck:value}));
  for(const value of [0,-1,101,1.5,Number.NaN,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>validateAutomaticCheck({automaticCheckRecentPages:value}));
  for(const value of [1,5,100])assert.doesNotThrow(()=>validateAutomaticCheck({automaticCheckRecentPages:value}));
});

test("legacy descriptors without a check mode mean a complete inventory",()=>{
  assert.equal(descriptorCheckMode(undefined),"all");
  for(const mode of ["new","recent","all"])assert.equal(descriptorCheckMode(mode),mode);
});

test("automatic page eligibility includes unfinished IDs outside a recent window and policy keys only vary by mode/window",()=>{
  const pages=Array.from({length:6},(_,index)=>({id:`p${index+1}`,number:index+1,fingerprint:`f${index+1}`}));
  const options={mode:"recent",recentPages:2,previous:pages,pendingPageIds:["p1","p4"]};
  assert.deepEqual([...automaticPageIds(options,pages)], ["p1","p4","p5","p6"]);
  assert.deepEqual([...automaticPageIds({...options,mode:"new"},pages)], ["p1","p4"]);
  assert.equal(automaticPolicyKey({mode:"new",recentPages:2,previous:[]}),"new:0");
  assert.equal(automaticPolicyKey({mode:"recent",recentPages:2,previous:[]}),"recent:2");
  assert.equal(automaticPolicyKey({mode:"recent",recentPages:3,previous:[]}),"recent:3");
});
