#!/usr/bin/env node
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath}from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// Inventory is evidence, not a frozen scenario-count contract or proof of coverage.
export function auditCoverage(root=ROOT){
 const files=[];const visit=dir=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(e.isSymbolicLink()||e.name==='node_modules'||e.name.startsWith('.'))continue;const p=path.join(dir,e.name);if(e.isDirectory())visit(p);else if(e.name.endsWith('.test.js'))files.push(path.relative(root,p).split(path.sep).join('/'));}};
 visit(path.join(root,'tests/node'));files.sort();
 const tests=files.flatMap(file=>Array.from(fs.readFileSync(path.join(root,file),'utf8').matchAll(/\btest\s*\(\s*(['"`])([^\n]+?)\1/gu),m=>({file,name:m[2]})));
 return {ok:files.length>0,files,tests,errors:files.length?[]:['No Node regression test files found'],limitations:['Static test inventory does not prove execution, scenario parity, branch coverage or human acceptance.']};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const r=auditCoverage();process.stdout.write(JSON.stringify(r,null,2)+'\n');if(!r.ok)process.exitCode=1;}catch(e){process.stderr.write(e.message+'\n');process.exitCode=1;}
}
