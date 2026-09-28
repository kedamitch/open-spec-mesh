import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "smol-toml";
import { DELETE,setTomlValue } from "./lib/toml-edit.js";
import { assertNoSymlinkPath } from "./lib/fs-safe.js";
import { adaptSkillMarkdown,defaultHome,hostProfile,loadRole,renderDispatchContract,renderMain,renderMcpOverlay,renderOpenCodeAgentMap,renderRole,renderRules,ROLES } from "./host-adapter.js";
import { ensureResearchTools,researchCommandsFromPath } from "./research-tools.js";

const SOURCE=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const CORE_SKILLS=["sdd-init","sdd-migrate","sdd-change","sdd-do","sdd-close","sdd-research","sdd-release","sdd-diagnose"];
const COMPAT_SKILLS=["prd-spec","design-overview"];
const SKILLS=[...CORE_SKILLS,...COMPAT_SKILLS];
const PACKAGE="kedamitch/open-spec-mesh";
const BEGIN="<!-- open-spec-mesh: BEGIN -->",END="<!-- open-spec-mesh: END -->";
const CODEX_MANIFEST=".open-spec-mesh-managed.json";
const HOST_MANIFEST="open-spec-mesh/managed-host.json";

function copyTree(src,dst){
  assertNoSymlinkPath(src);assertNoSymlinkPath(path.dirname(dst));
  fs.cpSync(src,dst,{recursive:true,errorOnExist:true,force:false,dereference:false});
  const walk=(p)=>{for(const e of fs.readdirSync(p,{withFileTypes:true})){const q=path.join(p,e.name);if(e.isSymbolicLink())throw new Error("Refusing symlink: "+q);if(e.isDirectory())walk(q);}};
  if(fs.statSync(dst).isDirectory())walk(dst);
}
function mergeManagedRules(existing,managed){
  const b=existing.split(BEGIN).length-1,e=existing.split(END).length-1;
  if(b!==e||b>1)throw new Error("Invalid Open Spec Mesh managed markers");
  const block=BEGIN+"\n\n"+managed.trimEnd()+"\n\n"+END+"\n";
  if(b===1){const i=existing.indexOf(BEGIN),j=existing.indexOf(END,i);return existing.slice(0,i)+block+existing.slice(j+END.length).replace(/^\r?\n?/,"");}
  const sep=!existing?"":existing.endsWith("\n\n")?"":existing.endsWith("\n")?"\n":"\n\n";
  return existing+sep+block;
}
function runtimeIndex(includeDocs=false){
  let text="# 运行导航\n\n[使用指南](skills/sdd-init/references/runtime-guide.md) · [角色](agents/index.md)\n\n## 核心技能\n\n";
  text+=CORE_SKILLS.map(n=>"- ["+n+"](skills/"+n+"/SKILL.md)\n").join("");
  text+="\n## 写作兼容入口\n\n"+COMPAT_SKILLS.map(n=>"- ["+n+"](skills/"+n+"/SKILL.md)\n").join("");
  if(includeDocs)text+="\n[配置包项目资料](docs/index.md)\n";
  return text;
}
function runtimeReadme(includeDocs=false){
  let text="# Open Spec Mesh\n\n**Spec-Driven Multi-Agent Development**\n\nQuick 由 Main 直接完成；需要 Worker 分工时进入 SDD，由 Architect 先规划，再按 sdd-change → sdd-do → sdd-close 执行。\n\n[运行指南](skills/sdd-init/references/runtime-guide.md) · [技能导航](index.md) · [工作约定](AGENTS.md)\n\n这是 Agent Host 运行目录，不是业务项目。\n";
  if(includeDocs)text+="\n已选择安装 [配置包项目资料](docs/index.md)。\n";return text;
}
function readJson(file){if(!fs.existsSync(file))return null;if(fs.lstatSync(file).isSymbolicLink())throw new Error("Refusing symlink: "+file);return JSON.parse(fs.readFileSync(file,"utf8"));}
function codexManaged(home){
  const data=readJson(path.join(home,CODEX_MANIFEST)),out=new Set();if(!data)return out;
  if(data.schema!==1||data.package!==PACKAGE)throw new Error("Unknown Codex install manifest");
  for(const name of data.skills||[])out.add("skills/"+name);for(const role of data.roles||[])out.add("agents/"+role+".toml");return out;
}
function hostManaged(home,host){
  const data=readJson(path.join(home,HOST_MANIFEST));if(!data)return new Set();
  if(data.schema!==1||data.package!==PACKAGE||data.host!==host)throw new Error("Unknown host install manifest");
  if(!Array.isArray(data.paths))throw new Error("Invalid host install manifest");
  const out=new Set();for(const item of data.paths){if(typeof item!=="string"||path.isAbsolute(item)||item.includes("..")||item.includes("\\"))throw new Error("Unsafe host manifest path");out.add(item);}return out;
}
const codexManifest=()=>JSON.stringify({schema:1,package:PACKAGE,skills:SKILLS,roles:ROLES},null,2)+"\n";
const hostManifest=(host,paths)=>JSON.stringify({schema:1,package:PACKAGE,host,paths:[...paths].sort()},null,2)+"\n";
const baseline=()=>fs.readFileSync(path.join(SOURCE,"config.toml"),"utf8");
function mergeCodexConfig(existing,commands){
  let text=existing||baseline();const current=parse(text),base=parse(baseline());
  const existingV2=current.features?.multi_agent_v2||{},agents=current.agents||{};
  let budget=existingV2.max_concurrent_threads_per_session??agents.max_concurrent_threads_per_session??agents.max_threads;
  if(!Number.isInteger(budget)||budget<1)budget=base.features.multi_agent_v2.max_concurrent_threads_per_session;
  for(const key of ["max_depth","max_threads","max_concurrent_threads_per_session"])text=setTomlValue(text,["agents",key],DELETE);
  const v2={...base.features.multi_agent_v2,max_concurrent_threads_per_session:budget};
  for(const [p,v] of [
    [["model"],base.model],[["model_reasoning_effort"],base.model_reasoning_effort],[["features","multi_agent"],true],[["features","multi_agent_v2"],v2],
    [["agents","enabled"],true],[["agents","default_subagent_model"],base.agents.default_subagent_model],[["agents","default_subagent_reasoning_effort"],base.agents.default_subagent_reasoning_effort]
  ])text=setTomlValue(text,p,v);
  if(!("web_search" in current))text=setTomlValue(text,["web_search"],base.web_search);
  let parsedNow=parse(text);
  for(const tool of ["codegraph","context7","tavily"]){
    const previous=parsedNow.mcp_servers?.[tool];
    if(previous&&previous.url)continue;
    const known=previous?.command;
    if(previous&&known&&!["codegraph","context7-mcp","tavily-mcp"].includes(known)&&!String(known).includes(".open-spec-mesh-tools"))continue;
    const value={...(previous||base.mcp_servers[tool]),command:commands[tool]};
    if(tool==="codegraph")value.args=["serve","--mcp"];else delete value.args;
    if(tool==="context7")value.env_vars=[...new Set([...(value.env_vars||[]),"CONTEXT7_API_KEY"])];
    if(tool==="tavily")value.env_vars=[...new Set([...(value.env_vars||[]),"TAVILY_API_KEY"])];
    text=setTomlValue(text,["mcp_servers",tool],value);parsedNow=parse(text);
  }
  const laya=current.mcp_servers?.laya;text=laya?setTomlValue(text,["mcp_servers","laya","enabled"],false):setTomlValue(text,["mcp_servers","laya"],DELETE);
  for(const role of ROLES){const data=loadRole(SOURCE,role);text=setTomlValue(text,["agents",role],{description:data.description,config_file:"agents/"+role+".toml"});}
  parse(text);return text;
}
function rewriteSkillMarkdown(root,host,home){
  if(host==="codex")return;
  const walk=(p)=>{for(const e of fs.readdirSync(p,{withFileTypes:true})){const q=path.join(p,e.name);if(e.isDirectory())walk(q);else if(e.isFile()&&q.endsWith(".md"))fs.writeFileSync(q,adaptSkillMarkdown(fs.readFileSync(q,"utf8"),host,home));}};walk(root);
}
function stageCodex(stage,home,commands,includeDocs){
  const oldRules=path.join(home,"AGENTS.md"),existingRules=fs.existsSync(oldRules)?fs.readFileSync(oldRules,"utf8"):"";
  fs.mkdirSync(stage,{recursive:true});fs.writeFileSync(path.join(stage,"AGENTS.md"),mergeManagedRules(existingRules,fs.readFileSync(path.join(SOURCE,"AGENTS.md"),"utf8")));
  fs.writeFileSync(path.join(stage,"README.md"),runtimeReadme(includeDocs));fs.writeFileSync(path.join(stage,"index.md"),runtimeIndex(includeDocs));
  const cfg=path.join(stage,"config.toml"),oldCfg=path.join(home,"config.toml");fs.writeFileSync(cfg,mergeCodexConfig(fs.existsSync(oldCfg)?fs.readFileSync(oldCfg,"utf8"):"",commands),{mode:fs.existsSync(oldCfg)?fs.statSync(oldCfg).mode&0o777:0o600});
  for(const skill of SKILLS)copyTree(path.join(SOURCE,skill),path.join(stage,"skills",skill));
  for(const file of ["index.md","dispatch-contract.md"])copyTree(path.join(SOURCE,"agents",file),path.join(stage,"agents",file));
  for(const role of ROLES)copyTree(path.join(SOURCE,"agents",role+".toml"),path.join(stage,"agents",role+".toml"));
  fs.writeFileSync(path.join(stage,CODEX_MANIFEST),codexManifest());if(includeDocs)copyTree(path.join(SOURCE,"docs"),path.join(stage,"docs"));
}
function stageHost(stage,host,home,commands,includeDocs){
  const profile=hostProfile(host,home),ruleTarget=path.join(home,profile.rulesFile),existing=fs.existsSync(ruleTarget)?fs.readFileSync(ruleTarget,"utf8"):"";
  fs.mkdirSync(path.dirname(path.join(stage,profile.rulesFile)),{recursive:true});fs.writeFileSync(path.join(stage,profile.rulesFile),mergeManagedRules(existing,renderRules(SOURCE,host,home)));
  const dispatch=path.join(stage,"open-spec-mesh","dispatch-contract.md");fs.mkdirSync(path.dirname(dispatch),{recursive:true});fs.writeFileSync(dispatch,renderDispatchContract(SOURCE,host,home));
  let overlay=renderMcpOverlay(host,commands);if(host==="opencode"){const data=JSON.parse(overlay);data.default_agent="main";data.agents=renderOpenCodeAgentMap(SOURCE,home);overlay=JSON.stringify(data,null,2)+"\n";}fs.writeFileSync(path.join(stage,profile.mcpOverlay),overlay);
  for(const skill of SKILLS){const target=path.join(stage,"skills",skill);copyTree(path.join(SOURCE,skill),target);rewriteSkillMarkdown(target,host,home);}
  for(const role of ["main",...ROLES]){const target=path.join(stage,"agents",role+".md");fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,role==="main"?renderMain(SOURCE,host,home):renderRole(SOURCE,host,role,home));}
  const paths=[profile.rulesFile,"open-spec-mesh/dispatch-contract.md",profile.mcpOverlay,...SKILLS.map(n=>"skills/"+n),...["main",...ROLES].map(n=>"agents/"+n+".md")];
  if(includeDocs){copyTree(path.join(SOURCE,"docs"),path.join(stage,"docs"));paths.push("docs");}
  const manifest=path.join(stage,HOST_MANIFEST);fs.mkdirSync(path.dirname(manifest),{recursive:true});paths.push(HOST_MANIFEST);fs.writeFileSync(manifest,hostManifest(host,paths));return paths;
}
function nearestExisting(p){let q=path.resolve(p);while(!fs.existsSync(q))q=path.dirname(q);return q;}
function managedPaths(host,includeDocs,home){
  if(host==="codex")return ["README.md","index.md","AGENTS.md","config.toml",CODEX_MANIFEST,...SKILLS.map(n=>"skills/"+n),"agents/index.md","agents/dispatch-contract.md",...ROLES.map(n=>"agents/"+n+".toml"),...(includeDocs?["docs"]:[])];
  const profile=hostProfile(host,home);return [profile.rulesFile,"open-spec-mesh/dispatch-contract.md",profile.mcpOverlay,...SKILLS.map(n=>"skills/"+n),...["main",...ROLES].map(n=>"agents/"+n+".md"),HOST_MANIFEST,...(includeDocs?["docs"]:[])];
}
function installStage(stage,home,paths,obsolete=[]){
  const anchor=nearestExisting(path.dirname(home)),transaction=fs.mkdtempSync(path.join(anchor,".osm-install-")),rollback=path.join(transaction,"rollback");fs.mkdirSync(rollback);
  const moved=[],installed=[];
  try{
    for(const rel of [...paths,...obsolete]){const target=path.join(home,rel);if(!fs.existsSync(target))continue;const old=path.join(rollback,rel);fs.mkdirSync(path.dirname(old),{recursive:true});fs.renameSync(target,old);moved.push([target,old]);}
    for(const rel of paths){const src=path.join(stage,rel),target=path.join(home,rel);fs.mkdirSync(path.dirname(target),{recursive:true});copyTree(src,target);installed.push(target);}
  }catch(error){
    for(const target of installed.reverse())fs.rmSync(target,{recursive:true,force:true});
    for(const [target,old] of moved.reverse()){fs.mkdirSync(path.dirname(target),{recursive:true});if(fs.existsSync(target))fs.rmSync(target,{recursive:true,force:true});fs.renameSync(old,target);}throw error;
  }finally{fs.rmSync(transaction,{recursive:true,force:true});}
}
export async function installRuntime({host="codex",home=null,dryRun=false,installTools=true,includeProjectDocs=false,withLaya=false,reporter=()=>{}}={}){
  if(!["codex","opencode","claude"].includes(host))throw new Error("Unknown host: "+host);
  if(withLaya)throw new Error("Managed System One/Laya is not enabled in the JS rewrite until C03-04 parity is complete");
  home=path.resolve(home||defaultHome(host));assertNoSymlinkPath(home);
  if(home===SOURCE||home.startsWith(SOURCE+path.sep)||SOURCE.startsWith(home+path.sep))throw new Error("Source and host home must be disjoint directories");
  if(fs.existsSync(home)&&!fs.statSync(home).isDirectory())throw new Error("Host home must be a directory");
  const previous=host==="codex"?codexManaged(home):hostManaged(home,host),paths=managedPaths(host,includeProjectDocs,home);
  const exclusive=host==="codex"?[...SKILLS.map(n=>"skills/"+n),...ROLES.map(n=>"agents/"+n+".toml")]:paths.filter(p=>p!==hostProfile(host,home).rulesFile&&p!==HOST_MANIFEST);
  for(const rel of exclusive){const target=path.join(home,rel);if(fs.existsSync(target)&&!previous.has(rel))throw new Error("Unmanaged host artifact exists: "+rel);}
  const toolHome=host==="codex"?home:path.join(home,"open-spec-mesh"),commands=installTools?ensureResearchTools(toolHome,{dryRun,reporter}):researchCommandsFromPath();
  if(!installTools)reporter("  WARNING tool installation skipped; MCP config references PATH commands");
  const anchor=nearestExisting(path.dirname(home)),scratch=fs.mkdtempSync(path.join(anchor,".osm-stage-")),stage=path.join(scratch,"stage");fs.mkdirSync(stage);
  try{
    const stagedPaths=host==="codex"?(stageCodex(stage,home,commands,includeProjectDocs),paths):stageHost(stage,host,home,commands,includeProjectDocs);
    if(dryRun)return{host,home,dryRun:true,paths:stagedPaths};installStage(stage,home,stagedPaths);return{host,home,dryRun:false,paths:stagedPaths};
  }finally{fs.rmSync(scratch,{recursive:true,force:true});}
}
