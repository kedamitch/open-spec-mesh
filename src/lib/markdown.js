const FENCE_RE=new RegExp("^ {0,3}(("+String.fromCharCode(96)+"{3,}|~{3,}))(.*)$");
export const EVIDENCE_BEGIN="<!-- SDD:EVIDENCE:BEGIN -->";
export const EVIDENCE_END="<!-- SDD:EVIDENCE:END -->";
export function visibleLines(text){
  const out=[];let fence=null,comment=false;const lines=text.split(/\r?\n/);
  for(let index=0;index<lines.length;index++){
    const raw=lines[index],match=raw.match(FENCE_RE);
    if(fence){
      if(match&&match[1][0]===fence[0]&&match[1].length>=fence.length&&!match[3].trim())fence=null;
      continue;
    }
    if(comment){if(raw.includes("-->"))comment=false;continue;}
    if(raw===EVIDENCE_BEGIN||raw===EVIDENCE_END)out.push([index,raw]);
    else if(raw.includes("<!--"))comment=!raw.split("<!--",2)[1].includes("-->");
    else if(match)fence=match[1];
    else if(!raw.startsWith("    ")&&!raw.startsWith("\t"))out.push([index,raw]);
  }
  if(fence||comment)throw new Error("Unclosed Markdown code fence or HTML comment");
  return out;
}
export function requirePass(text){
  const lines=visibleLines(text).map(row=>row[1]);
  const heads=[];for(let i=0;i<lines.length;i++)if(lines[i]==="## 最终结论"||lines[i]==="## Final Decision")heads.push(i);
  if(heads.length!==1)throw new Error("Exactly one final-decision heading required");
  const content=[];
  for(const line of lines.slice(heads[0]+1)){
    if(/^#{1,2}\s/.test(line))break;
    if(line.startsWith("<!--"))continue;
    if(line.trim())content.push(line.trim());
  }
  if(content.length!==1||content[0]!=="pass")throw new Error("Final decision must contain only pass");
}
