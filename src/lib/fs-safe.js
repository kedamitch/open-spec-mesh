import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function inside(root,...parts){
  const base=path.resolve(root),target=path.resolve(base,...parts);
  if(target!==base&&!target.startsWith(base+path.sep))throw new Error("Path escapes project root: "+target);
  return target;
}
export function assertNoSymlinkPath(target){
  const absolute=path.resolve(target),parsed=path.parse(absolute);
  const relative=absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let current=parsed.root;
  for(const part of relative){
    current=path.join(current,part);
    if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw new Error("Refusing symlink: "+current);
  }
}
export function createText(target,text){
  assertNoSymlinkPath(path.dirname(target));fs.mkdirSync(path.dirname(target),{recursive:true});
  const fd=fs.openSync(target,"wx",0o644);try{fs.writeFileSync(fd,text,"utf8");}finally{fs.closeSync(fd);}
}
export function atomicWrite(target,text){
  assertNoSymlinkPath(target);fs.mkdirSync(path.dirname(target),{recursive:true});
  const tmp=path.join(path.dirname(target),"."+path.basename(target)+"."+process.pid+"."+crypto.randomBytes(6).toString("hex"));
  let mode=0o644;if(fs.existsSync(target))mode=fs.statSync(target).mode&0o777;
  fs.writeFileSync(tmp,text,{encoding:"utf8",mode});fs.renameSync(tmp,target);
}
export async function withProjectLock(root,fn){
  const digest=crypto.createHash("sha256").update(path.resolve(root)).digest("hex");
  const lock=path.join(os.tmpdir(),"open-spec-mesh-"+digest+".lock");
  try{fs.mkdirSync(lock);}catch(error){if(error?.code==="EEXIST")throw new Error("Project is already locked: "+root);throw error;}
  try{return await fn();}finally{fs.rmSync(lock,{recursive:true,force:true});}
}
