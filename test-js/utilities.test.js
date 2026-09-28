import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { initializeProject } from "../src/commands/init.js";
import { migrateProject } from "../src/commands/migrate.js";
import { createResearch,createAdr } from "../src/commands/research.js";
import { createDocument } from "../src/commands/document.js";
import { createRelease,checkRelease } from "../src/commands/release.js";
import { validateDocs } from "../src/commands/validate.js";

const temp=(n)=>fs.mkdtempSync(path.join(os.tmpdir(),n));
test("research ADR and numbered document use canonical numbering",async()=>{
  const root=temp("osm-utils-");try{
    await initializeProject(root);
    const research=await createResearch(root,"latency");assert.equal(path.basename(research),"R01-latency");assert.ok(fs.existsSync(path.join(research,"R01-01-research-report.md")));
    const adr=await createAdr(root,"Use-Node");assert.equal(path.basename(adr),"ADR-001-decision.md");assert.match(fs.readFileSync(adr,"utf8"),/^# Use-Node/m);
    const doc=await createDocument(root,"docs/02-product/P02-modules","orders");assert.equal(path.basename(doc),"P02-01-orders.md");
    assert.deepEqual(validateDocs(root),[]);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test("legacy migration preserves old docs and creates explicit migration map",async()=>{
  const root=temp("osm-migrate-");try{
    fs.mkdirSync(path.join(root,"docs"));fs.writeFileSync(path.join(root,"docs","legacy.md"),"# Old\n");
    const map=await migrateProject(root);
    assert.ok(fs.existsSync(path.join(root,".sdd-migration","legacy-docs","legacy.md")));
    assert.equal(path.basename(map),"G02-migration-map.md");assert.match(fs.readFileSync(map,"utf8"),/legacy\.md/);
    assert.deepEqual(validateDocs(root),[]);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test("release new/check requires completed changes, pass verdict and checked checklist",async()=>{
  const root=temp("osm-release-");try{
    await initializeProject(root);
    const id="CHG-20260928-test",change=path.join(root,"docs","05-changes","C02-已完成",id);fs.mkdirSync(change);
    fs.writeFileSync(path.join(change,"index.md"),"---\nid: "+id+"\nstatus: completed\n---\n# Done\n");
    const dir=await createRelease(root,"1.2.3","Release-1",[id]);
    const index=fs.readFileSync(path.join(dir,"index.md"),"utf8"),noteName=index.match(/note: (.+)/)[1].trim(),checkName=index.match(/checklist: (.+)/)[1].trim();
    const note=path.join(dir,noteName),check=path.join(dir,checkName);
    fs.writeFileSync(note,fs.readFileSync(note,"utf8").replace("pending","pass"));
    fs.writeFileSync(check,fs.readFileSync(check,"utf8").replaceAll("[ ]","[x]"));
    assert.equal(checkRelease(root,path.relative(root,dir)),"1.2.3");
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
