import fs from "node:fs";
import path from "node:path";
import { atomicWrite,createText,inside } from "./fs-safe.js";

export const AREAS={
  "01-governance":"G","02-product":"P","03-architecture":"T","04-operations":"O",
  "05-changes":"C","06-decisions":"ADR","07-research":"R","08-quality":"Q","09-delivery":"D"
};
export const CODE_SOURCE="(?:[GPTOCRQD][0-9]{2}(?:-[0-9]{2})*|ADR-[0-9]{3})";
export function titleCheck(title){
  if(!/^[A-Za-z0-9_\-\u3400-\u9fff]{1,80}$/u.test(title)||!/[A-Za-z\u3400-\u9fff]/u.test(title))
    throw new Error("名称仅允许中英文文字、数字、下划线和连字符。");
}
export function refreshIndex(directory){
  const file=path.join(directory,"index.md");
  let old=fs.existsSync(file)?fs.readFileSync(file,"utf8"):"# "+path.basename(directory)+"\n";
  const begin="<!-- INDEX:BEGIN -->",end="<!-- INDEX:END -->";
  const links=fs.readdirSync(directory,{withFileTypes:true}).filter(e=>e.name!=="index.md"&&!e.name.startsWith(".")).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)
    .map(e=>"- ["+e.name+"]("+e.name+(e.isDirectory()?"/index.md":"")+")").join("\n");
  const block=begin+"\n"+links+"\n"+end;
  const bc=old.split(begin).length-1,ec=old.split(end).length-1;
  if(bc){
    if(bc!==1||ec!==1||old.indexOf(end)<old.indexOf(begin))throw new Error("Invalid index markers: "+file);
    old=old.slice(0,old.indexOf(begin))+block+old.slice(old.indexOf(end)+end.length);
  }else old=old.trimEnd()+"\n\n"+block+"\n";
  atomicWrite(file,old);
}
export function prefix(root,parent){
  const docs=path.join(root,"docs"),rel=path.relative(docs,parent);
  if(!rel||rel.startsWith("..")||path.isAbsolute(rel))throw new Error("请选择 docs 的一级分类或其子目录。");
  const parts=rel.split(path.sep),base=AREAS[parts[0]];
  if(!base)throw new Error("请选择 docs 的一级分类或其子目录。");
  if(parts.length===1||/^CHG-\d{8}-.+/.test(path.basename(parent)))return base;
  const m=path.basename(parent).match(new RegExp("^("+CODE_SOURCE+")-"));
  if(!m||!m[1].startsWith(base))throw new Error("Invalid parent code: "+parent);
  return m[1];
}
export function allocate(root,parent,title,{directory=false,extension="md",content=""}={}){
  titleCheck(title);parent=inside(root,path.relative(root,parent));
  if(!fs.existsSync(parent)||!fs.statSync(parent).isDirectory()||!/^[a-z0-9]+$/.test(extension))throw new Error("Invalid parent or extension");
  const stem=prefix(root,parent),lead=stem.length===1?stem:stem+"-",width=stem==="ADR"?3:2;
  const pattern=new RegExp("^"+lead.replace(/[.*+?^$()|[\]\\]/g,"\\$&")+"(\\d{"+width+"})-");
  const nums=[];
  for(const name of fs.readdirSync(parent)){const m=name.match(pattern);if(m)nums.push(Number(m[1]));}
  if(new Set(nums).size!==nums.length||nums.includes(0))throw new Error("Existing duplicate/zero numbering; repair before allocating.");
  const number=(nums.length?Math.max(...nums):0)+1;if(number>=10**width)throw new Error("编号已用尽，请按主题增加层级。");
  const name=lead+String(number).padStart(width,"0")+"-"+title,target=path.join(parent,directory?name:name+"."+extension);
  if(directory){fs.mkdirSync(target);createText(path.join(target,"index.md"),content||"# "+title+"\n");}
  else createText(target,content||"# "+title+"\n");
  refreshIndex(parent);return target;
}
