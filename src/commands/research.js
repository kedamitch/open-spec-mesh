import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inside,withProjectLock } from "../lib/fs-safe.js";
import { allocate,titleCheck } from "../lib/numbering.js";
import { projectRoot,readText } from "../lib/spec.js";

const PACKAGE=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const RESEARCH_TEMPLATE=path.join(PACKAGE,"sdd-research","references","research-template.md");
const ADR_TEMPLATE=path.join(PACKAGE,"sdd-research","references","adr-template.md");

export async function createResearch(root,title){
  root=projectRoot(root);titleCheck(title);const content=readText(RESEARCH_TEMPLATE);
  return withProjectLock(root,async()=>{
    const directory=allocate(root,inside(root,"docs","07-research"),title,{directory:true});
    allocate(root,directory,"research-report",{content});return directory;
  });
}
export async function createAdr(root,title){
  root=projectRoot(root);titleCheck(title);const template=readText(ADR_TEMPLATE);
  if(!template.startsWith("# ")||!template.includes("\n"))throw new Error("ADR template requires a title and body");
  const content="# "+title+"\n"+template.slice(template.indexOf("\n")+1);
  return withProjectLock(root,async()=>allocate(root,inside(root,"docs","06-decisions"),"decision",{content}));
}
