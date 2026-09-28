import fs from "node:fs";
import path from "node:path";
import { AREAS,CODE_SOURCE,prefix,titleCheck } from "../lib/numbering.js";
import { visibleLines } from "../lib/markdown.js";
import { metadata,projectRoot,readText } from "../lib/spec.js";

function dirs(root){const out=[root];for(const e of fs.readdirSync(root,{withFileTypes:true})){if(e.isDirectory())out.push(...dirs(path.join(root,e.name)));}return out;}
function runtimeGraph(file){
  if(path.basename(file)!=="C03-task-graph.json"||path.basename(path.dirname(file))!=="C03-tasks")return false;
  const change=path.dirname(path.dirname(file));if(!/^CHG-\d{8}-.+/.test(path.basename(change)))return false;
  try{const [fields]=metadata(readText(path.join(change,"index.md")));return fields.graph==="C03-tasks/C03-task-graph.json";}catch{return false;}
}
export function validateDocs(root){
  root=projectRoot(root);const docs=path.join(root,"docs"),errors=[];
  if(!fs.existsSync(docs)||!fs.statSync(docs).isDirectory()||fs.lstatSync(docs).isSymbolicLink())return["docs must be a real directory"];
  const rootEntries=fs.readdirSync(docs,{withFileTypes:true});
  if(rootEntries.some(e=>e.name!=="index.md"&&!e.isDirectory()))errors.push("Only index.md and categories allowed at docs root");
  const categories=rootEntries.filter(e=>e.isDirectory()).map(e=>e.name).sort();
  if(JSON.stringify(categories)!==JSON.stringify(Object.keys(AREAS).sort()))errors.push("Expected consecutive 01–09 categories");
  for(const directory of dirs(docs).sort()){
    if(fs.lstatSync(directory).isSymbolicLink()){errors.push("Symlink: "+directory);continue;}
    if(!fs.existsSync(path.join(directory,"index.md"))||!fs.statSync(path.join(directory,"index.md")).isFile())errors.push("Missing index: "+directory);
    if(directory===docs)continue;
    let stem;try{stem=prefix(root,directory);}catch(error){errors.push(error.message);continue;}
    const lead=stem.length===1?stem:stem+"-",width=stem==="ADR"?3:2,seen=new Set();
    for(const e of fs.readdirSync(directory,{withFileTypes:true})){
      const child=path.join(directory,e.name);if(e.isSymbolicLink()){errors.push("Symlink: "+child);continue;}if(e.name==="index.md")continue;
      if(e.isFile()&&runtimeGraph(child))continue;if(e.isFile()&&!e.name.endsWith(".md"))errors.push("Non-Markdown document: "+child);
      let title;
      if(["C01-进行中","C02-已完成"].includes(path.basename(directory))&&e.isDirectory()&&/^CHG-\d{8}-.+/.test(e.name))title=e.name.slice(13);
      else{
        const escaped=lead.replace(/[.*+?^$()|[\]\\]/g,"\\$&"),m=e.name.match(new RegExp("^"+escaped+"(\\d{"+width+"})-(.+)$"));
        if(!m){errors.push("Invalid numbering: "+child);continue;}
        if(seen.has(m[1])||Number(m[1])===0)errors.push("Duplicate/zero number: "+child);seen.add(m[1]);title=e.isDirectory()?m[2]:path.parse(m[2]).name;
      }
      if(e.isFile()&&!/^[A-Za-z][A-Za-z0-9_-]*$/.test(title))errors.push("Document filename must be English: "+child);
      try{titleCheck(title);}catch{errors.push("Invalid title: "+child);}
    }
  }
  const walkMd=(dir)=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const q=path.join(dir,e.name);if(e.isSymbolicLink())continue;if(e.isDirectory())walkMd(q);else if(e.isFile()&&e.name.endsWith(".md")){
    try{for(const [,line] of visibleLines(fs.readFileSync(q,"utf8"))){for(const match of line.matchAll(/\]\(([^)]+)\)/g)){const target=match[1];if(target.includes("://")||target.startsWith("#")||target.startsWith("mailto:"))continue;const rel=target.split("#")[0];if(rel&&!fs.existsSync(path.resolve(path.dirname(q),rel)))errors.push("Broken link: "+q+": "+rel);}}}
    catch(error){errors.push(q+": "+error.message);}
  }}};walkMd(docs);return errors;
}
