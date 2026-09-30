import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {sddArtifacts}from '../../../lib/observation/collect.js';import {diagnose}from '../../../lib/observation/diagnose.js';
test('manual Change without Graph or legacy metadata is normal read-only evidence',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'osm-manual-observe-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const id='CHG-20260929-manual';const dir=path.join(root,'docs/05-changes/C01-进行中',id);await fs.mkdir(dir,{recursive:true});
 await fs.writeFile(path.join(dir,'index.md'),'# Manual Change\n');await fs.writeFile(path.join(dir,'C01-change.md'),'# Goal\n');
 const result=await sddArtifacts(root,id);assert.equal(result.graph,'absent');assert.equal(result.status,'active');assert.deepEqual(result.tasks,[]);
 const report=diagnose({expectation:{mode:'sdd'},sdd:result,events:[]});assert.equal(JSON.stringify(report).includes('未观察到成功的 SDD 命令'),false);
 await fs.writeFile(path.join(dir,'index.md'),'---\nid: CHG-20260929-other\n---\n');await assert.rejects(sddArtifacts(root,id),/identity mismatch/);
});


test('canonical SDD and legacy semi-auto modes report the same missing Change evidence', () => {
 const artifact = {status:'not_found',change_id:'CHG-20260929-missing',tasks:[],events:[]};
 const report = mode => diagnose({expectation:{mode},sdd:artifact,events:[]});
 const canonical = report('sdd');
 const alias = report('semi-auto');
 assert.deepEqual(canonical.findings, alias.findings);
 assert.ok(canonical.findings.some(item => item.rule === 'S02'));
 assert.equal(report('quick').findings.some(item => item.rule === 'S02'), false);
});
