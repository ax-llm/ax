import concurrent.futures
import json
import queue
import threading
import unittest
from axllm import ai, ax, typesafe, AxBalancer, ProviderRouter, AxCancellationToken, AxMCPWebSocketTransport

class Socket:
    def __init__(self):
        self.inbound, self.sent = queue.Queue(), queue.Queue()
        self.failure = None
    def send(self, text):
        if self.failure: raise RuntimeError(self.failure)
        self.sent.put(json.loads(text))
    def recv(self): return self.inbound.get(timeout=3)
    def close(self): self.inbound.put(None)
    def respond(self, id, value): self.inbound.put(json.dumps({'jsonrpc':'2.0','id':id,'result':value}))

class ParityTests(unittest.TestCase):
    def test_provider_credentials_are_isolated(self):
        from unittest.mock import patch
        import os
        with patch.dict(os.environ, {"OPENAI_API_KEY":"unrelated", "OPENAI_BASE_URL":"https://unrelated.example"}, clear=True):
            for factory in [lambda: ai("typesafe"), typesafe]:
                with self.assertRaisesRegex(Exception,"requires api_key"): factory()
            model=ai("typesafe", apiKey="typesafe-test")
            self.assertEqual(model.api_key,"typesafe-test")
            self.assertEqual(model.base_url,"https://api.typesafe.ai")

    def test_websocket_cleanup(self):
        socket=Socket()
        transport=AxMCPWebSocketTransport('ws://example.test',web_socket_factory=lambda *args:socket)
        transport.set_protocol_version('2025-03-26')
        request={'jsonrpc':'2.0','id':1,'method':'ping'}
        with concurrent.futures.ThreadPoolExecutor() as pool:
            try:
                socket.failure='send failed'
                with self.assertRaisesRegex(RuntimeError,'send failed'): transport.send(request)
                with self.assertRaisesRegex(RuntimeError,'send failed'): transport.send_batch([request,{**request,'id':2}])
                self.assertEqual(transport._pending,{})
                socket.failure=None
                old=AxCancellationToken()
                first=pool.submit(transport.send_with_context,request,None,{'cancellation':old})
                socket.sent.get(timeout=2);socket.respond(1,'first')
                self.assertEqual(first.result(2)['result'],'first')
                second=pool.submit(transport.send,request)
                socket.sent.get(timeout=2)
                old.cancel('obsolete request')
                with self.assertRaisesRegex(Exception,'already pending'): transport.send(request)
                socket.respond(1,'second');self.assertEqual(second.result(2)['result'],'second')
                cancel=AxCancellationToken()
                aborted=pool.submit(transport.send_batch,[request,{**request,'id':2}],{'cancellation':cancel})
                socket.sent.get(timeout=2);cancel.cancel('stop batch')
                with self.assertRaisesRegex(Exception,'stop batch'): aborted.result(2)
                self.assertEqual(transport._pending,{})
                closed=pool.submit(transport.send_batch,[request,{**request,'id':2}])
                socket.sent.get(timeout=2);transport.close()
                with self.assertRaisesRegex(Exception,'closed'): closed.result(2)
                self.assertEqual(transport._pending,{})
            finally: transport.close()

    def test_thresholds_native_and_concurrency(self):
        calls=[]
        def transport(request):
            calls.append(request)
            payload=request['json']
            return {'model':payload['model'],'answers':{key:{'type':'noul','noul':payload['state'].get('probability',0.9)} for key in payload['questions']},'usage':{'input_tokens':2,'output_tokens':1}}
        program=ax('ticket:string -> urgent:boolean(true "Outage", false "Routine") "Urgent?"')
        for threshold,expected in [(0,True),(0.9,True),(1,False)]:
            model=ai('typesafe',api_key='test',transport=transport,true_threshold=threshold)
            self.assertEqual(program.forward(model,{'ticket':'Outage'})['urgent'],expected)
            self.assertNotIn('trueThreshold',calls[-1]['json'])
            self.assertEqual(calls[-1]['json']['questions']['urgent']['criteria'],{'true':'Outage','false':'Routine'})
            self.assertNotIn('pair per line',calls[-1]['json']['state']['messages'][0]['content'])
        for value in [-0.1,1.1,float('nan'),float('inf'),'0.5']:
            with self.assertRaises(Exception):ai('typesafe',api_key='test',true_threshold=value)
        client=typesafe(api_key='test',transport=transport)
        with concurrent.futures.ThreadPoolExecutor() as pool:
            def call(index):
                key=f'question{index}'
                response=client.system_one({'state':{'probability':index/10},'questions':{key:{'type':'noul','instructions':None}}})
                self.assertEqual(response['answers'],{key:{'type':'noul','noul':index/10}})
            list(pool.map(call,range(10)))

    def test_routing_and_nonstreaming(self):
        typed_calls=[]; normal_calls=[]
        def typed(request):
            typed_calls.append(request)
            return {'model':'jev-latest','answers':{'urgent':{'type':'noul','noul':0.9}},'usage':{'input_tokens':1,'output_tokens':1}}
        def normal(request):
            normal_calls.append(request)
            return {'model':'gpt-5.4-mini','choices':[{'index':0,'message':{'role':'assistant','content':'{"answer":"hello"}'},'finish_reason':'stop'}],'usage':{'prompt_tokens':1,'completion_tokens':1,'total_tokens':2}}
        decision=ai('typesafe',api_key='test',transport=typed,models=None)
        generative=ai('openai',api_key='test',model='gpt-5.4-mini',transport=normal,models=None)
        only=AxBalancer([decision]); mixed=AxBalancer([decision,generative])
        self.assertTrue(only.get_features().get('requiresStructuredOutput'))
        self.assertFalse(mixed.get_features().get('requiresStructuredOutput',False))
        nested=AxBalancer([only, generative])
        only.validate_chat_request({"chat_prompt":[{"role":"user","content":"outage"}], "response_format":{"type":"json_schema","schema":{"name":"decision","schema":{"type":"object","properties":{"urgent":{"type":"boolean"}},"required":["urgent"]}}}})
        with self.assertRaises(ValueError): only.validate_chat_request({"chat_prompt":[{"role":"user","content":"reply"}]})
        self.assertEqual(typed_calls, [])
        for model in [mixed, nested, ProviderRouter({'providers':{'primary':decision,'alternatives':[generative]},'routing':{'capability':{'allowDegradation':True}}})]:
            self.assertEqual(ax('question:string -> answer:string').forward(model,{'question':'hi'})['answer'],'hello')
        self.assertEqual(typed_calls,[])
        self.assertTrue(ax('ticket:string -> urgent:boolean').forward(only,{'ticket':'outage'})['urgent'])
        schema={'type':'json_schema','schema':{'name':'decision','schema':{'type':'object','properties':{'urgent':{'type':'boolean'}},'required':['urgent']}}}
        chunks=list(decision.stream({'chat_prompt':[{'role':'user','content':'outage'}],'response_format':schema}))
        self.assertEqual(len(chunks),1)
        self.assertEqual(json.loads(chunks[0]['results'][0]['content']),{'urgent':True})

    def test_native_http_credentials_retry_get_cancel(self):
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
        received=[]; stalled=threading.Event(); release=threading.Event()
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_GET(self):
                received.append((self.command,self.headers.get('Content-Length'),self.headers.get('Authorization')))
                status=429 if len(received)==1 else 200
                body=json.dumps({'models':[{'name':'jev-latest','description':'Jev','release_date':'2026-09-01'}]}).encode()
                self.send_response(status);self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
            def do_POST(self):
                payload=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))))
                if payload.get('state') == 'headers':
                    stalled.set();release.wait(3)
                self.send_response(200);self.send_header('Content-Length','10000');self.end_headers();self.wfile.flush();stalled.set();release.wait(3)
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            credentials=[]
            def credential(request):
                credentials.append(request)
                return {'Authorization':f'Bearer key-{len(credentials)}'}
            client=typesafe(base_url=f'http://127.0.0.1:{server.server_port}',api_key='',credential_provider=credential,options={'retry':{'maxRetries':1,'initialDelayMs':1}})
            self.assertEqual(client.list_models()[0]['name'],'jev-latest')
            self.assertEqual(received,[('GET',None,'Bearer key-1'),('GET',None,'Bearer key-2')])
            self.assertEqual([v['operation'] for v in credentials],['models','models'])
            token=AxCancellationToken()
            with concurrent.futures.ThreadPoolExecutor() as pool:
                pending=pool.submit(client.system_one,{'state':None,'questions':{'flag':{'type':'noul'}}},{'cancellation':token})
                self.assertTrue(stalled.wait(2));token.cancel('stop native')
                with self.assertRaisesRegex(Exception,'stop native'):pending.result(1)
                self.assertEqual(len(token._subscriptions),0)
            release.set()
            import time
            time.sleep(0.02)
            # Cancellation must also interrupt a server withholding response headers.
            stalled.clear();release.clear()
            token=AxCancellationToken()
            with concurrent.futures.ThreadPoolExecutor() as pool:
                pending=pool.submit(client.system_one,{'state':'headers','questions':{'flag':{'type':'noul'}}},{'cancellation':token})
                self.assertTrue(stalled.wait(2));token.cancel('stop headers')
                with self.assertRaisesRegex(Exception,'stop headers'):pending.result(1)
                self.assertEqual(len(token._subscriptions),0)
        finally:release.set();server.shutdown();server.server_close();thread.join(2)

if __name__=='__main__': unittest.main()
