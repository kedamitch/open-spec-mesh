import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "smol-toml";
import { DELETE,setTomlValue } from "../src/lib/toml-edit.js";

test("TOML patch inserts nested values without changing unrelated data",()=>{
  const original='model_provider="user"\nmodel="old"\n[mcp_servers.keep]\ncommand="keep"\n[agents]\nmax_threads=10\n[agents.custom]\ndescription="user role"\n';
  let text=setTomlValue(original,["features","multi_agent"],true);
  text=setTomlValue(text,["features","multi_agent_v2"],{enabled:true,max_concurrent_threads_per_session:10});
  text=setTomlValue(text,["agents","max_threads"],DELETE);
  text=setTomlValue(text,["agents","worker"],{description:"worker",config_file:"agents/worker.toml"});
  const data=parse(text);
  assert.equal(data.model_provider,"user");
  assert.equal(data.mcp_servers.keep.command,"keep");
  assert.equal(data.agents.custom.description,"user role");
  assert.equal("max_threads" in data.agents,false);
  assert.equal(data.features.multi_agent,true);
  assert.equal(data.features.multi_agent_v2.max_concurrent_threads_per_session,10);
  assert.equal(data.agents.worker.config_file,"agents/worker.toml");
});

test("TOML patch preserves comments and unmanaged text",()=>{
  const original='# user comment\nmodel_provider = "mine"\n\n[mcp_servers.custom]\n# keep me\nurl = "https://example.test/mcp"\n';
  const text=setTomlValue(original,["web_search"],"live");
  assert.match(text,/# user comment/);
  assert.match(text,/# keep me/);
  assert.equal(parse(text).mcp_servers.custom.url,"https://example.test/mcp");
});
