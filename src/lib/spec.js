import fs from "node:fs";
import path from "node:path";
import { inside } from "./fs-safe.js";

export function projectRoot(value){
  const root=path.resolve(value);
  if(!fs.existsSync(root)||!fs.statSync(root).isDirectory())throw new Error("Project directory does not exist: "+root);
  return root;
}
export function readText(file){
  if(!fs.existsSync(file)||fs.lstatSync(file).isSymbolicLink()||!fs.statSync(file).isFile())throw new Error("Required regular file missing: "+file);
  return fs.readFileSync(file,"utf8");
}
export function metadata(text){
  const lines=text.match(/.*(?:\n|$)/g)?.filter(Boolean)||[];
  if(!lines.length||lines[0].trim()!=="---")throw new Error("Spec requires scalar frontmatter.");
  const fields={};
  for(let i=1;i<lines.length;i++){
    const line=lines[i];
    if(line.trim()==="---")return [fields,lines.slice(i+1).join("")];
    const pos=line.indexOf(":");
    if(pos<1)throw new Error("Spec frontmatter contains an invalid or duplicate field.");
    const key=line.slice(0,pos).trim(),value=line.slice(pos+1).trim();
    if(!key||!value||Object.hasOwn(fields,key))throw new Error("Spec frontmatter contains an invalid or duplicate field.");
    fields[key]=value;
  }
  throw new Error("Spec frontmatter is not closed.");
}
export function renderSpec(fields,body){
  return "---\n"+Object.entries(fields).map(([k,v])=>k+": "+v+"\n").join("")+"---\n"+body;
}
export function mappedPath(root,...parts){return inside(root,...parts);}
