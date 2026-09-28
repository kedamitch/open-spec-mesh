import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {initializeProject} from "../src/commands/init.js";
test("init creates canonical numbered scaffold and is idempotent",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"osm-init-"));
  try{
    await initializeProject(root);
    assert.ok(fs.existsSync(path.join(root,"AGENTS.md")));
    assert.ok(fs.existsSync(path.join(root,"docs/02-product/P01-product-overview.md")));
    assert.ok(fs.existsSync(path.join(root,"docs/03-architecture/T04-domain-model.md")));
    assert.ok(fs.existsSync(path.join(root,"docs/08-quality/Q01-validation.md")));
    const before=fs.readFileSync(path.join(root,"docs/index.md"),"utf8");
    await initializeProject(root);
    const after=fs.readFileSync(path.join(root,"docs/index.md"),"utf8");
    assert.equal(after,before);assert.equal((after.match(/<!-- INDEX:BEGIN -->/g)||[]).length,1);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test("init preserves existing project AGENTS",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"osm-init-rules-"));
  try{fs.writeFileSync(path.join(root,"AGENTS.md"),"# Existing\nkeep\n");await initializeProject(root);assert.equal(fs.readFileSync(path.join(root,"AGENTS.md"),"utf8"),"# Existing\nkeep\n");}
  finally{fs.rmSync(root,{recursive:true,force:true});}
});
