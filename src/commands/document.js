import path from "node:path";
import { inside,withProjectLock } from "../lib/fs-safe.js";
import { allocate } from "../lib/numbering.js";
import { projectRoot } from "../lib/spec.js";

export async function createDocument(root,parent,title,{directory=false}={}){
  root=projectRoot(root);
  if(!directory&&!/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(title))throw new Error("Document filename must be an English slug");
  return withProjectLock(root,async()=>allocate(root,inside(root,parent),title,{directory}));
}
