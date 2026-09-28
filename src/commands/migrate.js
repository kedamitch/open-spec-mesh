import fs from "node:fs";
import path from "node:path";
import { initializeProject } from "./init.js";
import { inside,withProjectLock } from "../lib/fs-safe.js";
import { allocate,AREAS } from "../lib/numbering.js";
import { projectRoot } from "../lib/spec.js";

function isCanonical(docs){
  if(!fs.existsSync(docs)||!fs.statSync(docs).isDirectory())return false;
  const dirs=fs.readdirSync(docs,{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>e.name).sort();
  return JSON.stringify(dirs)===JSON.stringify(Object.keys(AREAS).sort());
}
function markdownFiles(root,prefix=""){
  const out=[];for(const e of fs.readdirSync(root,{withFileTypes:true})){const rel=prefix?prefix+"/"+e.name:e.name,q=path.join(root,e.name);
    if(e.isSymbolicLink())continue;if(e.isDirectory())out.push(...markdownFiles(q,rel));else if(e.isFile()&&e.name.endsWith(".md"))out.push(rel);}
  return out.sort();
}
function migrationMap(legacy){
  const tick=String.fromCharCode(96),docs=markdownFiles(legacy);
  const rows=docs.length?docs.map(p=>"| "+tick+p+tick+" | 待迁移 | 待确认 |").join("\n"):"| 无 Markdown 文档 | 已核实 | 无 |";
  return "# Legacy Documentation Migration\n\n## Purpose\n\n记录旧文档事实迁移到当前 01–09 体系的去向。脚本只保存原文件并建立骨架，不猜测语义。\n\n## Legacy Source\n\n"+tick+".sdd-migration/legacy-docs/"+tick+"\n\n## Migration Map\n\n| Legacy Document | Status | Canonical Target |\n| --- | --- | --- |\n"+rows+"\n\n## Completion\n\n只有所有真实旧文档都已核对并迁入正确的 Current Truth / ADR / Research / Change，且 canonical docs 校验通过后，才可把迁移标记为完成。\n";
}
export async function migrateProject(root){
  root=projectRoot(root);const docs=inside(root,"docs"),migrationRoot=inside(root,".sdd-migration"),legacy=inside(root,".sdd-migration","legacy-docs"),agents=inside(root,"AGENTS.md");
  const agentsExisted=fs.existsSync(agents);
  await withProjectLock(root,async()=>{
    if(!fs.existsSync(docs)||!fs.statSync(docs).isDirectory()||fs.lstatSync(docs).isSymbolicLink())throw new Error("Legacy migration requires a real docs directory");
    if(isCanonical(docs))throw new Error("Project already uses the canonical 01-09 docs layout");
    if(fs.existsSync(migrationRoot))throw new Error(".sdd-migration already exists; inspect the previous migration before retrying");
    fs.mkdirSync(migrationRoot);try{fs.renameSync(docs,legacy);}catch(error){fs.rmSync(migrationRoot,{recursive:true,force:true});throw error;}
  });
  try{
    await initializeProject(root);
    return await withProjectLock(root,async()=>{
      const target=allocate(root,inside(root,"docs","01-governance"),"migration-map",{content:migrationMap(legacy)});
      return target;
    });
  }catch(error){
    await withProjectLock(root,async()=>{
      if(fs.existsSync(docs))fs.rmSync(docs,{recursive:true,force:true});
      if(fs.existsSync(legacy)&&!fs.existsSync(docs))fs.renameSync(legacy,docs);
      if(fs.existsSync(migrationRoot))fs.rmSync(migrationRoot,{recursive:true,force:true});
      if(!agentsExisted&&fs.existsSync(agents)&&fs.statSync(agents).isFile())fs.rmSync(agents);
    });throw error;
  }
}
