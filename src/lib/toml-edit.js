import { isDeepStrictEqual } from "node:util";
import { parse } from "smol-toml";

export const DELETE=Symbol("delete");

function key(name){return /^[A-Za-z0-9_-]+$/.test(name)?name:JSON.stringify(name);}
function literal(value){
  if(typeof value==="boolean")return value?"true":"false";
  if(typeof value==="string")return JSON.stringify(value);
  if(typeof value==="bigint"||typeof value==="number")return String(value);
  if(value instanceof Date)return value.toISOString();
  if(Array.isArray(value))return "["+value.map(literal).join(", ")+"]";
  if(value&&typeof value==="object")return "{"+Object.entries(value).map(([k,v])=>key(k)+" = "+literal(v)).join(", ")+"}";
  throw new Error("Unsupported TOML value type");
}
function statements(text){
  const rows=[];let start=0,i=0,depth=0,quote=null,comment=false;
  while(i<text.length){
    const c=text[i];
    if(comment){
      if(c!=="\n"){i++;continue;} comment=false;
    }else if(quote){
      if(quote[0]==='"'&&c==="\\"){i+=2;continue;}
      if(text.startsWith(quote,i)){i+=quote.length;quote=null;continue;}
      i++;continue;
    }else if(c==='"'||c==="'"){
      quote=text.startsWith(c.repeat(3),i)?c.repeat(3):c;i+=quote.length;continue;
    }else if(c==="#"){comment=true;}
    else if(c==="["||c==="{")depth++;
    else if(c==="]"||c==="}")depth--;
    if(c==="\n"&&depth===0){rows.push([start,i+1]);start=i+1;}
    i++;
  }
  if(quote||depth!==0)throw new Error("Cannot safely locate TOML statements");
  if(start<text.length)rows.push([start,text.length]);
  return rows;
}
function flattenMarker(obj,marker){
  const path=[];let current=obj;
  while(current&&typeof current==="object"&&!Array.isArray(current)&&!(marker in current)){
    const keys=Object.keys(current);if(keys.length!==1)throw new Error("Cannot locate TOML path");
    path.push(keys[0]);current=current[keys[0]];
    if(Array.isArray(current))current=current[current.length-1];
  }
  if(!current||current[marker]!==true)throw new Error("Cannot locate TOML path");
  return path;
}
function pathOfKey(raw){
  const marker="__osm_marker__";
  const obj=parse(raw+"."+marker+" = true");
  return flattenMarker(obj,marker).slice(0,-1);
}
function assignmentKey(stmt){
  let quote=null,escaped=false;
  for(let i=0;i<stmt.length;i++){
    const c=stmt[i];
    if(quote){
      if(escaped)escaped=false;
      else if(quote==='"'&&c==="\\")escaped=true;
      else if(c===quote)quote=null;
    }else if(c==='"'||c==="'")quote=c;
    else if(c==="=")return stmt.slice(0,i).trim();
  }
  throw new Error("Cannot locate TOML assignment");
}
function entries(text){
  let table=[];const out=[];
  for(const [start,end] of statements(text)){
    const stmt=text.slice(start,end),clean=stmt.trim();
    if(!clean||clean.startsWith("#"))out.push({start,end,kind:"comment",where:table,raw:null});
    else if(clean.startsWith("[")){
      const marker="__osm_table_marker__";
      table=flattenMarker(parse(stmt+"\n"+marker+" = true\n"),marker);
      out.push({start,end,kind:"table",where:table,raw:null});
    }else{
      const raw=assignmentKey(stmt),where=[...table,...pathOfKey(raw)];
      out.push({start,end,kind:"assignment",where,raw});
    }
  }
  return out;
}
function get(data,path){let cur=data;for(const k of path)cur=cur[k];return cur;}
function updateData(data,path,value){
  let cur=data;
  for(const k of path.slice(0,-1)){
    if(!(k in cur))cur[k]={};
    if(!cur[k]||typeof cur[k]!=="object"||Array.isArray(cur[k]))throw new Error("Managed TOML path is not a table");
    cur=cur[k];
  }
  if(value===DELETE)delete cur[path.at(-1)];else cur[path.at(-1)]=value;
}
export function setTomlValue(text,path,value){
  const before=parse(text),expected=structuredClone(before);updateData(expected,path,value);
  if(isDeepStrictEqual(before,expected))return text;
  const items=entries(text);let result=null;
  for(const item of items){
    if(item.kind==="assignment"&&item.where.length<=path.length&&item.where.every((v,i)=>path[i]===v)){
      let replacement;
      if(item.where.length===path.length&&value===DELETE)replacement="";
      else replacement=item.raw+" = "+literal(get(expected,item.where))+"\n";
      result=text.slice(0,item.start)+replacement+text.slice(item.end);break;
    }
  }
  if(result===null){
    if(value===DELETE||(value&&typeof value==="object"&&!Array.isArray(value))){
      const cuts=items.filter(item=>item.where.length>=path.length&&path.every((v,i)=>item.where[i]===v)).map(item=>[item.start,item.end]);
      result=text;
      for(const [start,end] of cuts.reverse())result=result.slice(0,start)+result.slice(end);
      if(value!==DELETE){
        if(!result.endsWith("\n"))result+="\n";
        if(result&&!result.endsWith("\n\n"))result+="\n";
        result+="["+path.map(key).join(".")+"]\n";
        for(const [k,v] of Object.entries(value))result+=key(k)+" = "+literal(v)+"\n";
      }
    }else{
      const parent=path.slice(0,-1);
      const headers=items.filter(item=>item.kind==="table"&&item.where.length<=parent.length&&item.where.every((v,i)=>parent[i]===v));
      let offset=0,prefix=[];
      if(headers.length){const best=headers.sort((a,b)=>b.where.length-a.where.length)[0];offset=best.end;prefix=best.where;}
      const addition=path.slice(prefix.length).map(key).join(".")+" = "+literal(value)+"\n";
      result=text.slice(0,offset)+addition+text.slice(offset);
    }
  }
  const after=parse(result);
  if(!isDeepStrictEqual(expected,after))throw new Error("Unrelated TOML values would change; original config is unchanged");
  return result;
}
