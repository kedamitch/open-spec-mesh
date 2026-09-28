import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const RESEARCH_TOOLS=[
  {server:"codegraph",pkg:"@colbymchenry/codegraph",binary:"codegraph"},
  {server:"context7",pkg:"@upstash/context7-mcp",binary:"context7-mcp",env:["CONTEXT7_API_KEY"]},
  {server:"tavily",pkg:"tavily-mcp",binary:"tavily-mcp",env:["TAVILY_API_KEY"]}
];
const npmCommand=()=>process.platform==="win32"?"npm.cmd":"npm";
const binName=(name)=>process.platform==="win32"?name+".cmd":name;
export function researchCommandsFromPath(){return Object.fromEntries(RESEARCH_TOOLS.map(t=>[t.server,t.binary]));}
export function ensureResearchTools(home,{dryRun=false,reporter=()=>{}}={}){
  const prefix=path.join(home,".open-spec-mesh-tools"),commands={};
  for(const tool of RESEARCH_TOOLS){
    const destination=path.join(prefix,tool.server);
    const binary=path.join(destination,"node_modules",".bin",binName(tool.binary));
    commands[tool.server]=binary;
    if(fs.existsSync(binary)){reporter("  TOOL reuse "+tool.server+": "+binary);continue;}
    reporter("  TOOL install "+tool.server+": "+tool.pkg+"@latest");
    if(dryRun)continue;
    fs.mkdirSync(destination,{recursive:true});
    const run=spawnSync(npmCommand(),["install","--prefix",destination,"--no-save","--no-package-lock","--no-audit","--no-fund","--engine-strict",tool.pkg+"@latest"],{encoding:"utf8",stdio:["ignore","pipe","pipe"],env:{...process.env}});
    if(run.error||run.status!==0){fs.rmSync(destination,{recursive:true,force:true});throw new Error("Unable to install "+tool.pkg+"@latest (npm exit "+(run.status??"spawn")+")");}
    if(!fs.existsSync(binary))throw new Error("Installed package has no executable: "+tool.binary);
  }
  for(const tool of RESEARCH_TOOLS)for(const name of tool.env||[])if(!process.env[name])reporter("  ENV "+name+": MISSING (tool installed; runtime auth not verified)");
  return commands;
}
