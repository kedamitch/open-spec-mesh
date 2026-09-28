import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {defaultHome,hostProfile,nativeArtifactPaths,renderMain,renderOpenCodeAgentMap,renderRole} from "../src/host-adapter.js";
const ROOT=path.resolve(".");
test("host homes and capabilities match current runtime",()=>{
  const env={HOME:"/home/test"};
  assert.equal(defaultHome("codex",env),"/home/test/.codex");
  assert.equal(defaultHome("opencode",env),"/home/test/.config/opencode");
  assert.equal(defaultHome("claude",env),"/home/test/.claude");
  assert.equal(hostProfile("codex","/tmp/c").nativeTrace,true);
  assert.equal(hostProfile("opencode","/tmp/o").nativeTrace,false);
  assert.equal(hostProfile("claude","/tmp/a").nativeTrace,false);
});
test("OpenCode agent map keeps canonical roles and no model override",()=>{
  const agents=renderOpenCodeAgentMap(ROOT,"/tmp/opencode-home");
  assert.deepEqual(new Set(Object.keys(agents)),new Set(["main","architect","worker","reviewer","explorer","librarian"]));
  assert.equal(agents.main.mode,"primary");assert.equal(agents.worker.mode,"subagent");
  for(const data of Object.values(agents))assert.equal("model" in data,false);
  assert.ok(agents.main.permissions.some(r=>r.action==="subagent"&&r.resource==="architect"&&r.effect==="allow"));
  assert.ok(agents.worker.permissions.some(r=>r.action==="subagent"&&r.resource==="*"&&r.effect==="deny"));
});
test("host-native role rendering preserves routing boundaries",()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),"osm-host-"));
  try{
    const open=renderRole(ROOT,"opencode","worker",temp);assert.match(open,/mode: subagent/);assert.doesNotMatch(open,/gpt-6-/);
    const claude=renderMain(ROOT,"claude",temp);assert.match(claude,/model: inherit/);assert.match(claude,/Agent\(architect, worker, reviewer, explorer, librarian\)/);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
test("native artifact paths stay host-specific",()=>{
  const open=nativeArtifactPaths("opencode","/tmp/o"),claude=nativeArtifactPaths("claude","/tmp/c");
  assert.equal(open.rules,"/tmp/o/AGENTS.md");assert.equal(claude.rules,"/tmp/c/CLAUDE.md");
  assert.equal(open.mcpOverlay,"/tmp/o/open-spec-mesh.opencode.json");assert.equal(claude.mcpOverlay,"/tmp/c/open-spec-mesh.mcp.json");
});
