import path from "node:path";
import { initializeProject } from "./commands/init.js";
import { hostProfile } from "./host-adapter.js";

function option(args,name,fallback){
  const i=args.indexOf(name);
  if(i<0)return fallback;
  if(i+1>=args.length)throw new Error(name+" requires a value");
  return args[i+1];
}
function help(){return [
  "Open Spec Mesh","","Usage:",
  "  osm init [--root PATH]",
  "  osm host-profile --host codex|opencode|claude [--home PATH]",
  "  osm --version","",
  "The Node rewrite only exposes commands with a deterministic JS implementation."
].join("\n");}
export async function main(args){
  if(args.length===0||args.includes("--help")||args.includes("-h")){process.stdout.write(help()+"\n");return;}
  if(args[0]==="--version"||args[0]==="version"){process.stdout.write("0.1.0-dev.1\n");return;}
  if(args[0]==="init"){
    const root=path.resolve(option(args,"--root",process.cwd()));
    await initializeProject(root);process.stdout.write(root+"\n");return;
  }
  if(args[0]==="host-profile"){
    const host=option(args,"--host");if(!host)throw new Error("--host is required");
    process.stdout.write(JSON.stringify(hostProfile(host,option(args,"--home")),null,2)+"\n");return;
  }
  throw new Error("Unknown command: "+args[0]+"\n\n"+help());
}
