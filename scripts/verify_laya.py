#!/usr/bin/env python3
"""Actual MCP SDK stdio round-trip against a local fake HTTP backend. No Laya weights."""
from __future__ import annotations

import asyncio
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import tomllib

sys.path.insert(0,str(Path(__file__).resolve().parent))
import install
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

ROOT=Path(__file__).resolve().parents[1]


def parse(result):
    return json.loads(''.join(c.text for c in result.content if getattr(c,'type',None)=='text'))


async def run():
    calls=[]
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_GET(self):
            if self.path == '/health':
                self.send({'status':'ok','loaded':['multilingual']});return
            if self.path == '/v1/models':
                if self.headers.get('Authorization')!='Bearer fixture-jev':
                    self.send({'error':'unauthorized'},401);return
                calls.append((self.path,None))
                self.send([{'id':'jev-latest'}]);return
            self.send({'error':'not found'},404)
        def do_POST(self):
            body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            def result(request):
                answers={}
                for name,q in request['questions'].items():
                    if name=='mode':
                        value='sdd'
                    elif name=='executor':
                        value='explorer'
                    else:
                        value=next(iter(q['criteria']))
                    answers[name]={'type':'choice','choice':value}
                return {'model':request.get('model'),'answers':answers,'usage':{'input_tokens':1,'output_tokens':0}}
            if self.path == '/v1/systemone/batch':
                if self.headers.get('Authorization')!='Bearer fixture-laya':
                    self.send({'error':'unauthorized'},401);return
                calls.append((self.path,body))
                if not isinstance(body.get('requests'), list):
                    self.send({'error':'batch required'},400);return
                self.send([result(r) for r in body['requests']]);return
            if self.path == '/v1/systemone':
                if self.headers.get('Authorization')!='Bearer fixture-jev':
                    self.send({'error':'unauthorized'},401);return
                calls.append((self.path,body))
                self.send(result(body));return
            self.send({'error':'not found'},404)
        def send(self,body,status=200):
            raw=json.dumps(body).encode();self.send_response(status)
            self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)))
            self.end_headers();self.wfile.write(raw)
    http=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    thread=threading.Thread(target=http.serve_forever,daemon=True);thread.start()
    try:
        with tempfile.TemporaryDirectory(prefix='laya-stdio-') as temp:
            home=Path(temp)/'codex'
            os.environ.update({'LAYA_BASE_URL':f'http://127.0.0.1:{http.server_port}', 'LAYA_API_KEY':'fixture-laya',
                               'CONTEXT7_API_KEY':'fixture-context', 'TAVILY_API_KEY':'fixture-tavily'})
            # Real isolated pip installation, then normal transactional file/config installation.
            install.ensure_laya_mcp(home)
            install.install(ROOT,home,validate=False,with_laya=True)
            cfg=tomllib.loads((home/'config.toml').read_text())['mcp_servers']['laya']
            env={k:os.environ[k] for k in cfg['env_vars'] if k in os.environ}
            params=StdioServerParameters(command=cfg['command'],args=cfg['args'],env={**os.environ,**env})
            async with stdio_client(params) as (reader,writer):
                async with ClientSession(reader,writer) as session:
                    await session.initialize()
                    tools={t.name for t in (await session.list_tools()).tools}
                    assert tools=={'laya_templates','laya_decide','laya_predict','laya_status'},tools
                    data=parse(await session.call_tool('laya_templates',{}));assert len(data['templates'])==2
                    data=parse(await session.call_tool('laya_decide',{'decision':'execution-mode@1','items':[{'id':'a','state':{'request':'Need a Change'}}]}))
                    assert data['results'][0]['recommendation']['mode']=='sdd',data
                    assert data['metrics']['backend']=='server_batch' and len(calls)==1,data
                    assert len(calls[0][1]['requests'])==1,calls
                    data=parse(await session.call_tool('laya_decide',{'decision':'execution-mode@1','items':[{'id':'a','state':{'request':'Task A'}},{'id':'b','state':{'request':'Task B'}}]}))
                    assert data['metrics']['backend']=='server_batch' and len(calls)==2,data
                    assert len(calls[1][1]['requests'])==2,calls
                    data=parse(await session.call_tool('laya_decide',{
                        'decision':'delegation@1',
                        'items':[{'id':'delegate-test','state':{
                            'request':'Trace API Controller through queue, retry state machine and final sender.',
                            'current_role':' Main ',
                            'available_roles':[' Explorer ','LIBRARIAN','Worker',' reviewer '],
                            'known_facts':['Main only knows the API entry point'],
                            'actual_cost_statistics_available':False,
                        }}]}))
                    assert data['status']=='ok',data
                    assert data['results'][0]['recommendation']=={'executor':'explorer'},data
                    assert data['results'][0]['basis']=='model',data
                    assert data['metrics']['backend']=='server_batch' and len(calls)==3,data
                    delegated=calls[2][1]['requests'][0]['state']
                    assert delegated['current_role']=='main',delegated
                    assert delegated['execution_mode']=='quick',delegated
                    assert delegated['available_roles']==['explorer','librarian'],delegated
                    assert 'role_descriptions' not in delegated,delegated
                    questions=calls[2][1]['requests'][0]['questions']
                    assert set(questions)=={'executor'},questions
                    executor=questions['executor']
                    assert set(executor['criteria'])=={'main','explorer','librarian','uncertain'},executor
                    assert '流程控制、派发、集成和验收' in executor['criteria']['main'],executor
                    assert '已有足够事实' in executor['criteria']['main'],executor
                    assert '优先 Explorer' in executor['instructions'],executor
                    assert '优先 Librarian' in executor['instructions'],executor
                    assert '只在当前角色和 state.available_roles 中选择' in executor['instructions'],executor
                    assert 'task_graph_ready' not in executor['instructions'],executor
                    assert '本地实现' in executor['criteria']['explorer'],executor
                    assert '外部文档' in executor['criteria']['librarian'],executor
                    for role in delegated['available_roles']:
                        role_cfg=tomllib.loads((home/f'agents/{role}.toml').read_text())
                        assert executor['criteria'][role]==role_cfg['description'],(role,executor,role_cfg['description'])
                    data=parse(await session.call_tool('laya_predict',{'state':{'request':'Prototype'},
                        'questions':{'kind':{'type':'choice','instructions':'Classify','criteria':['one','two']}}}))
                    assert data['answers']['kind']['choice']=='one' and len(calls)==4,data
                    assert len(calls[3][1]['requests'])==1,calls
                    assert all(path=='/v1/systemone/batch' for path,_ in calls),calls
                    install.install(ROOT,home,validate=False,with_laya=False)
                    data=parse(await session.call_tool('laya_decide',{'decision':'execution-mode@1','items':[{'id':'a','state':{'request':'Disabled'}}]}))
                    assert data['reason']=='disabled' and len(calls)==4,data
                    assert not (home/'skills/typesafe-laya').exists()
                    install.install(ROOT,home,validate=False,with_laya=True)
                    data=parse(await session.call_tool('laya_status',{}));assert data['status']=='ok'

            # Reuse the installed MCP with the official TypeSafe/Jev environment and wire contract.
            jev_env={**os.environ,
                     'SYSTEMONE_PROVIDER':'jev',
                     'TYPESAFE_API_KEY':'fixture-jev',
                     'TYPESAFE_BASE_URL':f'http://127.0.0.1:{http.server_port}',
                     'TYPESAFE_DEFAULT_MODEL':'jev-latest'}
            params=StdioServerParameters(command=cfg['command'],args=cfg['args'],env=jev_env)
            before=len(calls)
            async with stdio_client(params) as (reader,writer):
                async with ClientSession(reader,writer) as session:
                    await session.initialize()
                    status=parse(await session.call_tool('laya_status',{}))
                    assert status['status']=='ok' and status['provider']=='jev' and status['models_only'] is True,status
                    data=parse(await session.call_tool('laya_decide',{
                        'decision':'delegation@1',
                        'items':[{'id':'jev-delegate','state':{
                            'request':'Trace a local call chain.',
                            'current_role':'main',
                            'available_roles':['explorer','worker'],
                        }}]}))
                    assert data['results'][0]['recommendation']=={'executor':'explorer'},data
                    assert data['metrics']['backend']=='jev_systemone' and data['metrics']['network_calls']==1,data
                    data=parse(await session.call_tool('laya_decide',{
                        'decision':'execution-mode@1',
                        'items':[{'id':'j1','state':{'request':'Task 1'}},{'id':'j2','state':{'request':'Task 2'}}]}))
                    assert data['metrics']['backend']=='jev_systemone' and data['metrics']['network_calls']==2,data
            jev_calls=calls[before:]
            assert jev_calls[0][0]=='/v1/models',jev_calls
            posts=[entry for entry in jev_calls if entry[0]=='/v1/systemone']
            assert len(posts)==3,jev_calls
            assert all(body['model']=='jev-latest' for _,body in posts),posts

            print('PASS: actual SDK initialize/list/call; Laya batch + TypeSafe/Jev /v1/systemone providers; execution-mode@1 quick-default and delegation@1 investigation-preferring executor Choice; installed role descriptions; live disable/reenable; isolated runtime installation')
            print('No GPU inference, real service authentication, model quality or cost savings measured.')
    finally:
        http.shutdown();http.server_close();thread.join()


if __name__=='__main__':asyncio.run(run())
