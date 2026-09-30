import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {initialize}from '../../../lib/documents/init.js';import {runValidateDocs}from '../../../lib/documents/validate.js';import {createChange,ensureDesign}from '../../../lib/documents/change.js';
test('document format and link warnings do not become phase authorization failures',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'osm-doc-advisory-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));await initialize(root);
 fs.writeFileSync(path.join(root,'docs/02-product/notes.md'),'# Extra notes\n[missing](not-created.md)\n');let warnings='';let output='';
 assert.equal(await runValidateDocs(['--root',root],{stderr:{write:x=>warnings+=x},stdout:{write:x=>output+=x}}),0);assert.match(warnings,/warning/);assert.match(output,/advisory/);
});
test('plain Markdown Change index is accepted but symlinked design is refused',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'osm-doc-safe-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));await initialize(root);
 const dir=await createChange(root,'macro');const id=path.basename(dir);fs.writeFileSync(path.join(dir,'index.md'),'# Human navigation\n');
 const outside=path.join(root,'outside');fs.writeFileSync(outside,'keep');fs.symlinkSync(outside,path.join(dir,'C02-design.md'));
 await assert.rejects(ensureDesign(root,id),/Symlink/);assert.equal(fs.readFileSync(outside,'utf8'),'keep');
});
