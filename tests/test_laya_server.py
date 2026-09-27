"""Optional API tests use a fake Router, not a GPU or downloaded weights."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
from pathlib import Path
import sys
import threading
import time
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'mcp'))
HAS_API=importlib.util.find_spec('fastapi') is not None and importlib.util.find_spec('httpx') is not None
if HAS_API:
    from laya_batch_server import create_app
    from fastapi.testclient import TestClient

Q={'kind':{'type':'choice','instructions':'Select.', 'criteria':['a','b']}}
ITEM={'state':{'request':'example'},'questions':Q,'model':'multilingual'}


class FakeRouter:
    def __init__(self):
        self.calls=[];self.active=0;self.peak=0
    def result(self):return {'answers':{'kind':{'type':'choice','choice':'a'}}}
    def predict(self,state,questions,model):
        self.active+=1;self.peak=max(self.peak,self.active)
        self.calls.append(('single',state));time.sleep(.02);self.active-=1
        return self.result()
    def predict_batch(self,requests,batch_size):
        self.active+=1;self.peak=max(self.peak,self.active)
        self.calls.append(('batch',len(requests),batch_size));time.sleep(.02);self.active-=1
        return [self.result() for _ in requests]


@unittest.skipUnless(HAS_API,'FastAPI/httpx integration dependencies installed in Laya CI')
class APITest(unittest.TestCase):
    def setUp(self):
        self.router=FakeRouter();self.client=TestClient(create_app(self.router,'secret'))
        self.client.__enter__();self.addCleanup(self.client.__exit__,None,None,None)
        self.headers={'Authorization':'Bearer secret'}

    def test_batch_calls_sdk_predict_batch_once(self):
        response=self.client.post('/v1/systemone/batch',json={'requests':[ITEM]*3},headers=self.headers)
        self.assertEqual(200,response.status_code,response.text)
        self.assertEqual(3,len(response.json()['results']))
        self.assertEqual([('batch',3,8)],self.router.calls)

    def test_unauthorized_oversize_bad_model_rejected_before_inference(self):
        self.assertEqual(401,self.client.post('/v1/systemone/batch',json={'requests':[ITEM]}).status_code)
        self.assertEqual(413,self.client.post('/v1/systemone',content=b' '*131073,headers=self.headers).status_code)
        self.assertEqual(422,self.client.post('/v1/systemone',json={**ITEM,'model':'english'},headers=self.headers).status_code)
        self.assertEqual(400,self.client.post('/v1/systemone',content=b'bad',headers=self.headers).status_code)
        self.assertEqual([],self.router.calls)

    def test_single_and_batch_share_one_executor(self):
        def request(i):
            if i%2:return self.client.post('/v1/systemone',json=ITEM,headers=self.headers)
            return self.client.post('/v1/systemone/batch',json={'requests':[ITEM]*2},headers=self.headers)
        with ThreadPoolExecutor(max_workers=8) as pool:responses=list(pool.map(request,range(8)))
        self.assertTrue(all(r.status_code in (200,503) for r in responses))
        self.assertEqual(1,self.router.peak)
        self.assertEqual(200,self.client.get('/health').status_code)

    def test_wrong_sdk_batch_size_results_is_safe_error(self):
        self.router.predict_batch=lambda *a,**kw: []
        result=self.client.post('/v1/systemone/batch',json={'requests':[ITEM]},headers=self.headers)
        self.assertEqual(500,result.status_code)
        self.assertEqual({'detail':'inference failed'},result.json())

    def test_token_budget_failure_before_inference(self):
        def budget(*args):raise ValueError('sensitive detail')
        with TestClient(create_app(self.router,'secret',check_budget=budget)) as client:
            result=client.post('/v1/systemone',json=ITEM,headers=self.headers)
            self.assertEqual(422,result.status_code)
            self.assertNotIn('sensitive detail',result.text)
        self.assertEqual([],self.router.calls)


if __name__=='__main__':unittest.main()
