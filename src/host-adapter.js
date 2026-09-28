import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const HOSTS=["codex","opencode","claude"];
export const ROLES=["architect","worker","reviewer","explorer","librarian"];

export function defaultHome(host,env=process.env){
  const home=env.HOME||os.homedir();
  if(host==="codex")return path.resolve(env.CODEX_HOME||path.join(home,".codex"));
  if(host==="opencode")return path.resolve(env.OPENCODE_CONFIG_DIR||path.join(home,".config","opencode"));
  if(host==="claude")return path.resolve(env.CLAUDE_CONFIG_DIR||path.join(home,".claude"));
  throw new Error("Unknown host: "+host);
}
export function hostProfile(host,home,env=process.env){
  if(!HOSTS.includes(host))throw new Error("Unknown host: "+host);
  const root=path.resolve(home||defaultHome(host,env));
  if(host==="codex")return{name:host,home:root,rulesFile:"AGENTS.md",skillsDir:"skills",agentsDir:"agents",cli:"codex",nativeTrace:true,mcpOverlay:null};
  if(host==="opencode")return{name:host,home:root,rulesFile:"AGENTS.md",skillsDir:"skills",agentsDir:"agents",cli:"opencode",nativeTrace:false,mcpOverlay:"open-spec-mesh.opencode.json"};
  return{name:host,home:root,rulesFile:"CLAUDE.md",skillsDir:"skills",agentsDir:"agents",cli:"claude",nativeTrace:false,mcpOverlay:"open-spec-mesh.mcp.json"};
}
function quotedValue(text,key){
  const m=text.match(new RegExp("^"+key+"\\s*=\\s*\"((?:\\\\.|[^\"])*)\"\\s*$","m"));
  if(!m)throw new Error("Missing canonical role field: "+key);
  return JSON.parse('"'+m[1]+'"');
}
function multilineValue(text,key){
  const m=new RegExp("^"+key+"\\s*=\\s*\"\"\"\\n?","m").exec(text);
  if(!m)throw new Error("Missing canonical role field: "+key);
  const start=m.index+m[0].length,end=text.indexOf('"""',start);
  if(end<0)throw new Error("Unclosed canonical role field: "+key);
  return text.slice(start,end);
}
export function loadRole(source,role){
  if(!ROLES.includes(role))throw new Error("Unknown role: "+role);
  const text=fs.readFileSync(path.join(source,"agents",role+".toml"),"utf8");
  const data={name:quotedValue(text,"name"),description:quotedValue(text,"description"),developer_instructions:multilineValue(text,"developer_instructions")};
  if(data.name!==role)throw new Error("Invalid canonical role: "+role);
  return data;
}
function skillNote(profile){
  if(profile.name==="codex")return "Skill 根为 "+path.join(profile.home,"skills")+"/。";
  return "Skill 使用 "+(profile.name==="opencode"?"OpenCode":"Claude Code")+" 原生 discovery；全局 Skill 根为 "+path.join(profile.home,"skills")+"/。";
}
export function adaptPrompt(text,profile){
  const dispatch=path.join(profile.home,"open-spec-mesh","dispatch-contract.md");
  let out=text
    .replace(/Skill 根为 \$CODEX_HOME\/skills\/（缺省 ~\/\.codex\/skills\/）。/g,skillNote(profile))
    .replaceAll("$CODEX_HOME/agents/dispatch-contract.md",dispatch)
    .replaceAll("agents/dispatch-contract.md",dispatch)
    .replace("- Skill 根：\`$CODEX_HOME/skills/\`。","- "+skillNote(profile))
    .replace("- Skill 入口：由 Host Adapter 映射到当前宿主的原生 Skill 根。","- "+skillNote(profile));
  if(profile.name==="opencode"){
    out=out
      .replace("- Agent 路由：由 Host Adapter 映射；角色语义、权限和 SDD 状态机不因宿主变化。","- Agent：使用 OpenCode 原生 primary/subagent 与 subagent 权限；角色语义和 SDD 状态机不变。")
      .replace('- V2：\`agent_type\` + \`fork_turns="none"\`；model / effort 由角色 TOML 固定。',"- Agent：使用 OpenCode 原生 primary/subagent 与 subagent tool；model/provider 继承用户宿主配置。")
      .replace('使用 agent_type + fork_turns="none"，不覆盖 model / effort。',"使用 OpenCode 原生 subagent tool 调用命名 subagent；不在派发时覆盖用户 model/provider。");
  }else if(profile.name==="claude"){
    out=out
      .replace("- Agent 路由：由 Host Adapter 映射；角色语义、权限和 SDD 状态机不因宿主变化。","- Agent：使用 Claude Code 原生 Agent/subagent；角色语义和 SDD 状态机不变。")
      .replace('- V2：\`agent_type\` + \`fork_turns="none"\`；model / effort 由角色 TOML 固定。',"- Agent：使用 Claude Code 原生 Agent/subagent；model/provider 继承用户宿主配置。")
      .replace('使用 agent_type + fork_turns="none"，不覆盖 model / effort。',"使用 Claude Code 原生 Agent tool 调用命名 subagent；不在派发时覆盖用户 model/provider。");
  }
  return out;
}
function opencodePermissions(role){
  const allowed=role==="main"?ROLES:role==="architect"?["explorer","librarian"]:[];
  const lines=["permission:","  task:",'    "*": deny',...allowed.map(n=>"    "+n+": allow")];
  if(["reviewer","explorer","librarian"].includes(role))lines.push("  edit: deny");
  return lines;
}
export function opencodeV2Permissions(role){
  const allowed=role==="main"?ROLES:role==="architect"?["explorer","librarian"]:[];
  const rules=[{action:"subagent",resource:"*",effect:"deny"}];
  for(const name of allowed)rules.push({action:"subagent",resource:name,effect:"allow"});
  if(["reviewer","explorer","librarian"].includes(role))rules.push({action:"edit",resource:"*",effect:"deny"});
  return rules;
}
export function renderOpenCodeAgentMap(source,home){
  const profile=hostProfile("opencode",home);
  const result={main:{description:"Open Spec Mesh Main：Quick/SDD 路由、调度、验收、集成与最终验证。",mode:"primary",permissions:opencodeV2Permissions("main")}};
  for(const role of ROLES){
    const data=loadRole(source,role);
    result[role]={description:data.description,mode:"subagent",system:adaptPrompt(data.developer_instructions,profile).trim(),permissions:opencodeV2Permissions(role)};
  }
  return result;
}
const yamlScalar=(value)=>JSON.stringify(value);
export function renderMain(source,host,home){
  const profile=hostProfile(host,home),prompt=adaptPrompt(fs.readFileSync(path.join(source,"AGENTS.md"),"utf8"),profile);
  if(host==="codex")return prompt;
  const description="Open Spec Mesh Main：Quick/SDD 路由、调度、验收、集成与最终验证。";
  const front=host==="opencode"
    ?["---","description: "+yamlScalar(description),"mode: primary",...opencodePermissions("main"),"---"]
    :["---","name: main","description: "+yamlScalar(description),"model: inherit","tools: Agent(architect, worker, reviewer, explorer, librarian), Read, Write, Edit, Bash, Glob, Grep, Skill, WebFetch, WebSearch","---"];
  return front.join("\n")+"\n\n"+prompt.trimEnd()+"\n";
}
export function renderRole(source,host,role,home){
  const profile=hostProfile(host,home),data=loadRole(source,role);
  if(host==="codex")return fs.readFileSync(path.join(source,"agents",role+".toml"),"utf8");
  const prompt=adaptPrompt(data.developer_instructions,profile);let front;
  if(host==="opencode")front=["---","description: "+yamlScalar(data.description),"mode: subagent",...opencodePermissions(role),"---"];
  else{
    const tools={architect:"Agent(explorer, librarian), Read, Write, Edit, Bash, Glob, Grep, Skill, WebFetch, WebSearch",worker:"Read, Write, Edit, Bash, Glob, Grep, Skill",reviewer:"Read, Bash, Glob, Grep, Skill",explorer:"Read, Bash, Glob, Grep, Skill",librarian:"Read, Bash, Glob, Grep, Skill, WebFetch, WebSearch"}[role];
    front=["---","name: "+role,"description: "+yamlScalar(data.description),"model: inherit","tools: "+tools,"---"];
  }
  return front.join("\n")+"\n\n"+prompt.trim()+"\n";
}
export function renderRules(source,host,home){
  const profile=hostProfile(host,home);let text=adaptPrompt(fs.readFileSync(path.join(source,"AGENTS.md"),"utf8"),profile);
  if(host==="claude")text="# Open Spec Mesh\n\nThis file is the Claude Code host adapter for the shared Open Spec Mesh rules.\n\n"+text;
  return text.trimEnd()+"\n";
}
export function nativeArtifactPaths(host,home){
  const p=hostProfile(host,home),result={rules:path.join(p.home,p.rulesFile),skills:path.join(p.home,p.skillsDir),agents:path.join(p.home,p.agentsDir),dispatch:path.join(p.home,"open-spec-mesh","dispatch-contract.md")};
  if(p.mcpOverlay)result.mcpOverlay=path.join(p.home,p.mcpOverlay);
  return result;
}


export function adaptSkillMarkdown(text,host,home){
  if(host==="codex")return text;
  const root=path.join(hostProfile(host,home).home,"skills");
  return text
    .replace('python3 "$CODEX_HOME/skills/sdd-migrate/scripts/migrate_project.py"',
             'python3 "'+path.join(root,"sdd-migrate","scripts","migrate_project.py")+'"')
    .replace('安装后使用 `$CODEX_HOME/skills/` 下对应脚本。','安装后使用 `'+root+'/\` 下对应脚本。');
}

export function renderDispatchContract(source,host,home){
  return adaptPrompt(
    fs.readFileSync(path.join(source,"agents","dispatch-contract.md"),"utf8"),
    hostProfile(host,home)
  ).trimEnd()+"\\n";
}

export function renderMcpOverlay(host,commands,{laya=null}={}){
  for(const name of ["codegraph","context7","tavily"]){
    if(!commands[name])throw new Error("Missing research tool command: "+name);
  }
  if(host==="opencode"){
    const servers={
      codegraph:{type:"local",command:[commands.codegraph,"serve","--mcp"]},
      context7:{type:"local",command:[commands.context7],environment:{CONTEXT7_API_KEY:"{env:CONTEXT7_API_KEY}"}},
      tavily:{type:"local",command:[commands.tavily],environment:{TAVILY_API_KEY:"{env:TAVILY_API_KEY}"}}
    };
    if(laya)servers.laya={type:"local",command:[laya.command,...(laya.args||[])],
      environment:Object.fromEntries((laya.env_vars||[]).map(n=>[n,"{env:"+n+"}"]))};
    return JSON.stringify({$schema:"https://opencode.ai/config.json",mcp:{servers}},null,2)+"\\n";
  }
  if(host==="claude"){
    const servers={
      codegraph:{type:"stdio",command:commands.codegraph,args:["serve","--mcp"]},
      context7:{type:"stdio",command:commands.context7,args:[],env:{CONTEXT7_API_KEY:"\${CONTEXT7_API_KEY}"}},
      tavily:{type:"stdio",command:commands.tavily,args:[],env:{TAVILY_API_KEY:"\${TAVILY_API_KEY}"}}
    };
    if(laya)servers.laya={type:"stdio",command:laya.command,args:[...(laya.args||[])],
      env:Object.fromEntries((laya.env_vars||[]).map(n=>[n,"\${"+n+"}"]))};
    return JSON.stringify({mcpServers:servers},null,2)+"\\n";
  }
  throw new Error("MCP overlay is only used for opencode/claude");
}
