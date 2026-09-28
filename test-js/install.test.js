import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parse } from "smol-toml";
import { installRuntime } from "../src/install.js";

const temp=(name)=>fs.mkdtempSync(path.join(os.tmpdir(),name));
test("OpenCode install preserves user config/rules and is idempotent",async()=>{
  const home=temp("osm-open-");
  try{
    fs.writeFileSync(path.join(home,"opencode.jsonc"),'{"model":"user/provider","plugins":["mine"]}\n');
    fs.writeFileSync(path.join(home,"AGENTS.md"),"# User rules\nNever deploy.\n");
    await installRuntime({host:"opencode",home,installTools:false});
    assert.equal(fs.readFileSync(path.join(home,"opencode.jsonc"),"utf8"),'{"model":"user/provider","plugins":["mine"]}\n');
    const rules=fs.readFileSync(path.join(home,"AGENTS.md"),"utf8");assert.match(rules,/Never deploy/);assert.equal((rules.match(/open-spec-mesh: BEGIN/g)||[]).length,1);
    const overlay=JSON.parse(fs.readFileSync(path.join(home,"open-spec-mesh.opencode.json"),"utf8"));
    assert.equal(overlay.default_agent,"main");assert.deepEqual(new Set(Object.keys(overlay.agents)),new Set(["main","architect","worker","reviewer","explorer","librarian"]));
    assert.ok(fs.existsSync(path.join(home,"skills","sdd-change","SKILL.md")));
    await installRuntime({host:"opencode",home,installTools:false});
    assert.equal((fs.readFileSync(path.join(home,"AGENTS.md"),"utf8").match(/open-spec-mesh: BEGIN/g)||[]).length,1);
  }finally{fs.rmSync(home,{recursive:true,force:true});}
});
test("Claude install preserves settings and renders native agents",async()=>{
  const home=temp("osm-claude-");
  try{
    fs.writeFileSync(path.join(home,"settings.json"),'{"model":"user-choice"}\n');
    fs.writeFileSync(path.join(home,"CLAUDE.md"),"# Personal\nKeep this.\n");
    await installRuntime({host:"claude",home,installTools:false});
    assert.equal(fs.readFileSync(path.join(home,"settings.json"),"utf8"),'{"model":"user-choice"}\n');
    assert.match(fs.readFileSync(path.join(home,"CLAUDE.md"),"utf8"),/Keep this/);
    const main=fs.readFileSync(path.join(home,"agents","main.md"),"utf8");assert.match(main,/model: inherit/);assert.match(main,/Agent\(architect, worker, reviewer, explorer, librarian\)/);
    const manifest=JSON.parse(fs.readFileSync(path.join(home,"open-spec-mesh","managed-host.json"),"utf8"));assert.equal(manifest.host,"claude");
  }finally{fs.rmSync(home,{recursive:true,force:true});}
});
test("Codex install patches managed TOML without losing user provider/custom entries",async()=>{
  const home=temp("osm-codex-");
  try{
    fs.writeFileSync(path.join(home,"config.toml"),'model_provider="user"\nmodel="old"\n[mcp_servers.keep]\ncommand="keep"\n[agents]\nmax_concurrent_threads_per_session=10\n[agents.custom]\ndescription="user role"\nconfig_file="agents/custom.toml"\n');
    fs.writeFileSync(path.join(home,"AGENTS.md"),"user rules\n");
    await installRuntime({host:"codex",home,installTools:false});
    const cfg=parse(fs.readFileSync(path.join(home,"config.toml"),"utf8"));
    assert.equal(cfg.model_provider,"user");assert.equal(cfg.mcp_servers.keep.command,"keep");assert.equal(cfg.agents.custom.description,"user role");
    assert.equal(cfg.features.multi_agent_v2.max_concurrent_threads_per_session,10);assert.equal(cfg.mcp_servers.context7.env_vars.includes("CONTEXT7_API_KEY"),true);
    const rules=fs.readFileSync(path.join(home,"AGENTS.md"),"utf8");assert.match(rules,/user rules/);assert.equal((rules.match(/open-spec-mesh: BEGIN/g)||[]).length,1);
  }finally{fs.rmSync(home,{recursive:true,force:true});}
});
test("dry-run creates no host home and unmanaged same-name skill fails closed",async()=>{
  const base=temp("osm-dry-"),home=path.join(base,"absent");
  try{
    await installRuntime({host:"claude",home,installTools:false,dryRun:true});assert.equal(fs.existsSync(home),false);
    const open=path.join(base,"open");fs.mkdirSync(path.join(open,"skills","sdd-do"),{recursive:true});fs.writeFileSync(path.join(open,"skills","sdd-do","SKILL.md"),"mine");
    await assert.rejects(()=>installRuntime({host:"opencode",home:open,installTools:false}),/Unmanaged host artifact/);assert.equal(fs.readFileSync(path.join(open,"skills","sdd-do","SKILL.md"),"utf8"),"mine");
  }finally{fs.rmSync(base,{recursive:true,force:true});}
});
