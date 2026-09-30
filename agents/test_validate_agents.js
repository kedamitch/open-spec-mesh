import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {validate,validateRuntimeConfig,validateAgentName}from './validate_agents.js';
test('canonical native role configuration and mirrors are valid',()=>assert.deepEqual(validate(),[]));
test('agent names use the actual role prefix and snake_case descriptions',()=>{
 for(const [r,n]of [['explorer','explorer_python_inventory'],['librarian','librarian_node_backend'],['worker','worker_document_tools'],['architect','architect_manual_design'],['reviewer','reviewer_delivery_check']])assert.equal(validateAgentName(r,n),true);
 for(const n of ['explorer','task1','worker_doc','explorer_Bad','explorer_a__b','explorer_a-b','explorer_../a'])assert.equal(validateAgentName('explorer',n),false);
});
test('model and disabled V2 remain real configuration errors',()=>{assert.ok(validateRuntimeConfig({}).length);assert.match(validateRuntimeConfig({}).join(' '),/Main must use Luna 6 max|Multi-Agent V2/);});
test('role model, sandbox and mirror drift is rejected',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'osm-role-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 fs.cpSync('agents',path.join(dir,'agents'),{recursive:true});fs.copyFileSync('config.toml',path.join(dir,'config.toml'));
 const p=path.join(dir,'agents/explorer.toml');fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace('sandbox_mode = "read-only"','sandbox_mode = "workspace-write"'));
 assert.match(validate(dir).join(' '),/sandbox drift/);
});
