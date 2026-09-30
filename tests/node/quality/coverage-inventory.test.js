import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {auditCoverage}from '../../../scripts/verify_coverage.js';
test('Node inventory is discovered evidence without a frozen Python count',()=>{
 const r=auditCoverage();assert.equal(r.ok,true);assert.ok(r.files.length>0);assert.ok(r.tests.length>0);assert.deepEqual(r.errors,[]);assert.match(r.limitations.join(' '),/does not prove execution/);
});
test('inventory detects no tests but allows ordinary test additions without replan',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'osm-test-inventory-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'tests/node'),{recursive:true});
 assert.equal(auditCoverage(root).ok,false);fs.writeFileSync(path.join(root,'tests/node/new.test.js'),"test('new behavior',()=>{});\n");const r=auditCoverage(root);assert.equal(r.ok,true);assert.deepEqual(r.tests,[{file:'tests/node/new.test.js',name:'new behavior'}]);
});
