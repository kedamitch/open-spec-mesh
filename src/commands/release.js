import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { atomicWrite,inside,withProjectLock } from "../lib/fs-safe.js";
import { visibleLines,requirePass } from "../lib/markdown.js";
import { allocate,refreshIndex,titleCheck } from "../lib/numbering.js";
import { metadata,projectRoot,readText,renderSpec } from "../lib/spec.js";

const PACKAGE=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const NOTE_TEMPLATE=path.join(PACKAGE,"sdd-release","references","release-template.md");
const CHECK_TEMPLATE=path.join(PACKAGE,"sdd-release","references","release-checklist-template.md");
const REQUIRED=["Build","Tests","Database","Configuration","Documentation","Deployment","Rollback"];

export async function createRelease(root,version,title,changes){
  root=projectRoot(root);titleCheck(title);
  if(!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version))throw new Error("Use a semantic version");
  if(!Array.isArray(changes)||!changes.length||new Set(changes).size!==changes.length)throw new Error("Provide unique completed Changes");
  const noteContent=readText(NOTE_TEMPLATE),checkContent=readText(CHECK_TEMPLATE);
  return withProjectLock(root,async()=>{
    const parent=inside(root,"docs","09-delivery","D01-发布记录");
    for(const name of fs.readdirSync(parent)){const directory=path.join(parent,name);if(!fs.statSync(directory).isDirectory())continue;
      const index=path.join(directory,"index.md");if(!fs.existsSync(index))continue;const [fields]=metadata(readText(index));if(fields.version===version)throw new Error("Version already exists");}
    for(const changeId of changes){const index=inside(root,"docs","05-changes","C02-已完成",changeId,"index.md"),[fields]=metadata(readText(index));
      if(fields.status!=="completed"||fields.id!==changeId)throw new Error("Change is not completed");}
    const directory=allocate(root,parent,"v"+version.replaceAll(".","-"),{directory:true});
    const note=allocate(root,directory,"release-notes",{content:noteContent}),checklist=allocate(root,directory,"release-checklist",{content:checkContent});
    atomicWrite(path.join(directory,"index.md"),renderSpec({version,title,changes:changes.join(","),note:path.basename(note),checklist:path.basename(checklist)},"\n# "+title+"\n"));
    refreshIndex(directory);return directory;
  });
}
export function requireChecklist(text){
  const visible=visibleLines(text).map(row=>row[1]).join("\n");
  for(const heading of REQUIRED)if(!new RegExp("^##\\s+"+heading+"\\s*$","m").test(visible))throw new Error("Release checklist missing section: "+heading);
  if(/^\s*-\s*\[\s\]\s+/m.test(visible))throw new Error("Release checklist still has unchecked items");
}
export function checkRelease(root,relative){
  root=projectRoot(root);const directory=inside(root,relative),[fields]=metadata(readText(path.join(directory,"index.md")));
  for(const changeId of fields.changes.split(",")){const [cf]=metadata(readText(inside(root,"docs","05-changes","C02-已完成",changeId,"index.md")));
    if(cf.status!=="completed"||cf.id!==changeId)throw new Error("Release references incomplete Change");}
  requirePass(readText(inside(root,path.relative(root,directory),fields.note)));
  requireChecklist(readText(inside(root,path.relative(root,directory),fields.checklist)));
  return fields.version;
}
