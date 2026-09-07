import json, threading
from axllm import ai, ax, fn, ProviderRouter
from axllm.session import run_control

started=threading.Event(); release=threading.Event(); requests=[]; calls=[]
def lookup(args):
    calls.append('lookup'); started.set()
    assert release.wait(2), 'model stream did not progress while the tool was pending'
    return 'REF-42'
def transport(req):
    requests.append(req)
    if len(requests)==1:
        assert req['json']['tools'][0].get('async') is True, req['json']['tools']
        def stream():
            events=[{'type':'response.created','response':{'id':'r1'}}, {'type':'response.output_item.done','item':{'type':'function_call','id':'i1','call_id':'c1','name':'lookup','arguments':'{}'}}]
            for e in events: yield 'data: '+json.dumps(e)+'\n\n'
            assert started.wait(2), 'tool was not started from a completed call'
            release.set()
            yield 'data: '+json.dumps({'type':'response.completed','response':{'id':'r1','model':'gpt-6-astra','output':[]}})+'\n\n'
        return {'status':200,'body':stream()}
    assert len(requests)==2, 'unexpected replay'
    assert req['json']['previous_response_id']=='r1'
    assert req['json']['input']==[{'type':'function_call_output','call_id':'c1','output':'REF-42'}], req['json']['input']
    return {'status':200,'body':'data: '+json.dumps({'type':'response.completed','response':{'id':'r2','model':'gpt-6-astra','output':[{'type':'message','id':'m2','content':[{'type':'output_text','text':'{"answer":"REF-42"}'}]}]}})+'\n\n'}
client=ai('openai',model='gpt-6-astra',api_key='test',transport=transport,model_config={'thinkingTokenBudget':'low'})
client=ProviderRouter({'providers':{'primary':client}})
tool=fn('lookup').description('Look up a reference').execution('background').handler(lookup).build()
program=ax('question -> answer', {'functions':[tool]})
result=program.forward(client,{'question':'Find reference'})
assert result=={'answer':'REF-42'}, result
assert calls==['lookup'], calls
print('python high-level async overlap and final incorporation passed')

# Each node owns its conversation even when a provider reuses a call ID.
from axllm import flow, f, MultiServiceRouter
flow_requests=[]; flow_calls=[]; events=[]
control=run_control()
control.on_event(events.append)
control.steer('Keep the reference exact.')
def flow_transport(req):
    flow_requests.append(req)
    body=req['json']; assert body['model']=='gpt-6-astra', body['model']; first=len(flow_requests)%2==1
    if first:
        assert not body.get('previous_response_id'), 'node inherited another conversation'
        response={'id':'node-start','model':'gpt-6-astra','output':[{'type':'function_call','id':'item','call_id':'same-call','name':'lookup','arguments':'{"query":"REF-42"}'}]}
    else:
        assert body['previous_response_id']=='node-start'
        assert body['input'][-1]=={'type':'function_call_output','call_id':'same-call','output':'REF-42'}, body['input']
        assert body['input'][0]['role']=='user', 'root update did not reach this node'
        response={'id':'node-final','model':'gpt-6-astra','output':[{'type':'message','id':'msg','content':[{'type':'output_text','text':'{"answer":"REF-42"}'}]}]}
    return {'status':200,'body':'data: '+json.dumps({'type':'response.completed','response':response})+'\n\n'}
flow_client=ai('openai',model='gpt-6-astra',api_key='test',transport=flow_transport)
flow_client=MultiServiceRouter([{'key':'smart','service':flow_client}])
assert flow_client.get_features('smart')['asyncTools']
flow_tool=fn('lookup').description('Look up reference').arg('query',f.string()).execution('background').handler(lambda args: (flow_calls.append(args['query']) or args['query'])).build()
workflow=flow().execute('first',ax('question -> answer',{'functions':[flow_tool]})).execute('second',ax('question -> answer',{'functions':[flow_tool]})).returns({'first':'firstResult','second':'secondResult'})
for _ in range(2):
    result=workflow.forward(flow_client,{'question':'Find reference'}, {'control':control,'model':'smart'})
    assert result=={'first':{'answer':'REF-42'},'second':{'answer':'REF-42'}}, result
assert len(flow_requests)==8 and len(flow_calls)==4, (len(flow_requests),flow_calls)
assert [e['path'] for e in events if e['type']=='applied']==['root/first','root/second']*2, events
print('python flow conversation isolation, future root updates, and controlled reruns passed')

control.on_event(lambda event: control.abort() if event['type']=='completed' and event['path']=='root/first' else None)
try:
    workflow.forward(flow_client,{'question':'Find reference'}, {'control':control,'model':'smart'})
    raise AssertionError('aborted flow returned success')
except RuntimeError as error:
    assert 'Flow aborted' in str(error), str(error)
assert len(flow_requests)==10 and len(flow_calls)==5, 'aborted flow started another node'

# Native steering accepts once and the server creates the successor response.
import queue
class SteeringSocket:
    def __init__(self):
        self.inbound=queue.Queue();self.sent=[];self.closed=False
    def send(self,event):
        self.sent.append(event)
        if event['type']=='response.create':
            assert len(self.sent)==1, 'accepted steering was replayed as a create'
            assert 'stream' not in event
            self.inbound.put({'type':'response.created','response':{'id':'parent'}})
            self.inbound.put({'type':'response.output_text.delta','delta':'provisional'})
        else:
            assert event['type']=='response.steer' and event['previous_response_id']=='parent'
            accepted={'type':'response.steer.accepted','steer':{'id':'steer1','previous_response_id':'parent'}}
            self.inbound.put(accepted);self.inbound.put(accepted)
            self.inbound.put({'type':'response.incomplete','response':{'id':'parent','model':'gpt-6-astra','incomplete_details':{'reason':'steered'},'output':[],'usage':{'input_tokens':3,'output_tokens':2}}})
            self.inbound.put({'type':'response.created','response':{'id':'successor'}})
            self.inbound.put({'type':'response.completed','response':{'id':'successor','model':'gpt-6-astra','output':[{'type':'message','id':'msg','content':[{'type':'output_text','text':'{"answer":"CORRECTED"}'}]}],'usage':{'input_tokens':4,'output_tokens':3}}})
    def recv(self):return self.inbound.get()
    def close(self):self.closed=True;self.inbound.put(None)
controller=run_control();native_events=[];steered=[]
def native_event(event):
    native_events.append(event)
    if event['type']=='model.output' and not steered:
        steered.append(True);controller.steer('Use CORRECTED.')
controller.on_event(native_event)
socket=SteeringSocket()
client=ai('openai',model='gpt-6-astra',api_key='test',web_socket_transport=socket)
program=ax('question -> answer')
assert program.forward(client,{'question':'Find answer'},{'control':controller})=={'answer':'CORRECTED'}
assert [event['timing'] for event in native_events if event['type']=='applied']==['native'], native_events
assert len(socket.sent)==2 and socket.closed
assert [entry['remote_id'] for entry in program.get_chat_log()]==['parent','successor'], program.get_chat_log()
print('python native steering, successor accounting, and closure passed')

# Cancellation releases the run and transport while an owned handler settles.
import time
class PendingSocket(SteeringSocket):
    def send(self,event):
        self.sent.append(event)
        assert len(self.sent)==1, 'cancelled work was replayed'
        self.inbound.put({'type':'response.created','response':{'id':'pending'}})
        self.inbound.put({'type':'response.output_item.done','item':{'type':'function_call','id':'item','call_id':'pending-call','name':'lookup','arguments':'{}'}})
cancel_control=run_control();cancel_events=[];cancel_control.on_event(cancel_events.append)
settled=threading.Event();pending_socket=PendingSocket()
def cancellable(args,context):
    assert context['call_id']=='pending-call'
    cancel_control.abort()
    assert context['signal'].wait(2), 'tool did not receive cancellation'
    settled.set()
    return 'LATE'
cancel_tool=fn('lookup').description('Lookup').execution('background').context_handler(cancellable).build()
cancel_program=ax('question -> answer',{'functions':[cancel_tool]})
clock=time.monotonic()
try:
    cancel_program.forward(ai('openai',model='gpt-6-astra',api_key='test',web_socket_transport=pending_socket),{'question':'Find answer'},{'control':cancel_control})
    raise AssertionError('cancelled run returned success')
except RuntimeError as error:
    assert 'pending-call' in str(error), error
assert time.monotonic()-clock<2 and pending_socket.closed
assert settled.wait(2) and len(pending_socket.sent)==1
assert cancel_events[-1]['pending_call_ids']==['pending-call'],cancel_events
invalid=fn('validated').description('Validation').returns_field('value',f.number()).context_handler(lambda args,context:{'value':'bad'}).build()
try:
    invalid.call({})
    raise AssertionError('context handler bypassed validation')
except ValueError:pass
print('python cancellation context, pending IDs, and late-result isolation passed')

# A handler that ignores cancellation must not keep the caller or transport alive.
late_control=run_control();late_socket=PendingSocket()
release_late=threading.Event();finished_late=threading.Event()
def ignores_cancellation(args):
    late_control.abort()
    assert release_late.wait(3), 'caller waited for noncooperative work'
    finished_late.set()
    return 'LATE'
late_program=ax('question -> answer',{'functions':[fn('lookup').description('Lookup').execution('background').handler(ignores_cancellation).build()]})
try:
    late_program.forward(ai('openai',model='gpt-6-astra',api_key='test',web_socket_transport=late_socket),{'question':'Find answer'},{'control':late_control})
    raise AssertionError('cancelled run returned success')
except RuntimeError as error:
    assert 'pending-call' in str(error), error
assert late_socket.closed and not finished_late.is_set()
late_traces=list(late_program.function_call_traces)
assert len(late_traces)==1 and late_traces[0]["id"]=="pending-call" and late_traces[0]["status"]=="unresolved",late_traces
release_late.set()
assert finished_late.wait(2)
assert late_program.function_call_traces==late_traces and len(late_socket.sent)==1
print('python noncooperative cancellation returns before tool completion')

# The agent executor exposes declared background tools through its normal API.
from axllm import agent
agent_requests=[];agent_calls=[];agent_started=threading.Event();agent_release=threading.Event()
agent_control=run_control();agent_control_events=[];agent_control.on_event(agent_control_events.append)
agent_control.steer('ROOT-GUIDANCE')
agent_control.steer('RESPONDER-ONLY',target='root/responder')
agent_control.set_thinking_token_budget('medium',target='root/executor')
def agent_lookup(args,context):
    assert context['call_id']=='agent-call' and not context['signal'].is_set()
    agent_calls.append(args['query']);agent_started.set()
    assert agent_release.wait(2), 'agent model work did not overlap the handler'
    return args['query']
def agent_response(id,text):
    return {'id':id,'model':'gpt-6-astra','output':[{'type':'message','id':'message-'+id,'content':[{'type':'output_text','text':text}]}]}
def agent_transport(request):
    agent_requests.append(request);number=len(agent_requests);body=request['json']
    if number in (1,2,5,6):
        assert not any(t.get('async') for t in body.get('tools',[])), 'actor authority leaked'
        stage='distiller' if number<3 else 'responder'
        if number in (2,6):
            assert body['previous_response_id']==stage+'-start',body
            assert 'ROOT-GUIDANCE' in json.dumps(body['input']),body
            assert ('RESPONDER-ONLY' in json.dumps(body['input'])) == (number==6),body
        text='{"completion":{"type":"final","args":["Find reference",{}]}}' if number<3 else '{"answer":"REF-42"}'
        if number==5:assert 'REF-42' in json.dumps(body), 'responder ran before final tool incorporation'
        response=agent_response(stage+('-start' if number in (1,5) else '-final'),text)
        return {'status':200,'body':'data: '+json.dumps({'type':'response.completed','response':response})+'\n\n'}
    if number==3:
        assert body['tools'][0]['name']=='tools_lookup' and body['tools'][0]['async'] is True,body['tools']
        def events():
            yield 'data: '+json.dumps({'type':'response.output_item.done','item':{'type':'function_call','id':'item','call_id':'agent-call','name':'tools_lookup','arguments':'{"query":"REF-42"}'}})+'\n\n'
            assert agent_started.wait(2);agent_release.set()
            yield 'data: '+json.dumps({'type':'response.completed','response':agent_response('executor1','{"completion":{"type":"final","args":["Report reference",{"answer":"provisional"}]}}')})+'\n\n'
        return {'status':200,'body':events()}
    assert number==4 and body['previous_response_id']=='executor1',body
    assert body['input'][-1]=={'type':'function_call_output','call_id':'agent-call','output':'REF-42'},body
    assert 'ROOT-GUIDANCE' in json.dumps(body['input']) and 'RESPONDER-ONLY' not in json.dumps(body['input']),body
    assert {'type':'configuration_update','reasoning':{'effort':'medium'}} in body['input'],body
    assert body.get('reasoning')==agent_requests[2]['json'].get('reasoning'), 'reasoning update changed original cache prefix'
    return {'status':200,'body':'data: '+json.dumps({'type':'response.completed','response':agent_response('executor2','{"completion":{"type":"final","args":["Report reference",{"answer":"REF-42"}]}}')})+'\n\n'}
agent_tool=fn('lookup').description('Lookup').arg('query',f.string()).execution('background').context_handler(agent_lookup).build()
agent_program=agent('question -> answer',{'functions':[agent_tool],'directResponse':'off'})
assert agent_program.forward(ai('openai',model='gpt-6-astra',api_key='test',transport=agent_transport),{'question':'Find reference'},{'control':agent_control})=={'answer':'REF-42'}
assert agent_calls==['REF-42'] and len(agent_requests)==6
assert len([event for event in agent_control_events if event['type']=='applied'])==5
assert {event['path'] for event in agent_control_events if event['type']=='started'}=={'root/distiller','root/executor','root/responder'}
activity=[entry for entry in agent_program.state['action_log'] if entry.get('type')=='function_call']
assert len(activity)==1 and activity[0]['qualified_name']=='tools.lookup',activity
assert agent_program.state['function_call_traces'][0]['call_id']=='agent-call'
assert agent_program.invoke_callable('tools.lookup',{'query':'REF-42'})['status']=='error'
assert agent_calls==['REF-42'], 'native call executed again through actor machinery'
print('python native agent tools, authority boundaries, action logs, and duplicate prevention passed')

# A real stalled HTTP body must close promptly when the run is cancelled.
import socket
listener=socket.socket()
listener.bind(('127.0.0.1',0))
listener.listen(1)
endpoint='http://%s:%s'%listener.getsockname()
http_closed=threading.Event()
def stalled_http():
    with listener:
        connection,_=listener.accept()
        with connection:
            connection.settimeout(3)
            reader=connection.makefile('rb')
            headers=[]
            while True:
                line=reader.readline()
                if line==b'\r\n':break
                headers.append(line)
            length=next(int(line.split(b':',1)[1]) for line in headers if line.lower().startswith(b'content-length:'))
            reader.read(length)
            body=('data: '+json.dumps({'type':'response.output_item.done','item':{'type':'function_call','id':'item','call_id':'http-pending','name':'lookup','arguments':'{}'}})+'\n\n').encode()
            connection.sendall(b'HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n'+('%x\r\n'%len(body)).encode()+body+b'\r\n')
            try:
                if reader.read(1)==b'':http_closed.set()
            except (ConnectionResetError,ConnectionAbortedError):
                http_closed.set()
            except TimeoutError:
                pass
            finally:
                reader.close()
threading.Thread(target=stalled_http,daemon=True).start()
http_control=run_control()
http_started={}
def abort_http(args,context):
    http_started['at']=time.monotonic()
    http_control.abort()
    assert context['signal'].wait(2)
    return 'LATE'
http_program=ax('question -> answer',{'functions':[fn('lookup').description('Lookup').execution('background').context_handler(abort_http).build()]})
try:
    http_program.forward(ai('openai',api_key='test',model='gpt-6-astra',base_url=endpoint),{'question':'Lookup'},{'control':http_control})
    raise AssertionError('Cancelled HTTP run returned success')
except RuntimeError as error:
    assert 'http-pending' in str(error),error
assert time.monotonic()-http_started['at']<2,'HTTP cancellation blocked the caller'
assert http_closed.wait(2),'HTTP reader retained its connection'
print('python cancellation closes a stalled native HTTP connection')

# A mixed balancer pins its ordinary-chat selection instead of forcing sessions
# merely because a different candidate supports async tools.
from axllm import AxBalancer
balanced_requests=[]
balanced_calls=[]
def ordinary_transport(request):
    body=request['json']
    balanced_requests.append(body)
    assert body['model']=='gpt-5.6',body
    assert not any(tool.get('async') for tool in body.get('tools',[])),body
    if len(balanced_requests)==1:
        message={'role':'assistant','tool_calls':[{'id':'balanced-call','type':'function','function':{'name':'lookup','arguments':'{}'}}]}
        finish='tool_calls'
    else:
        assert len(balanced_requests)==2 and balanced_calls==['done']
        assert any(message.get('tool_call_id')=='balanced-call' and json.loads(message.get('content','null'))=='FALLBACK' for message in body['messages']),body
        message={'role':'assistant','content':json.dumps({'answer':'FALLBACK'})}
        finish='stop'
    return {'status':200,'json':{'id':'balanced-'+str(len(balanced_requests)),'model':'gpt-5.6','choices':[{'index':0,'message':message,'finish_reason':finish}]}}
def unused_candidate(request):
    raise AssertionError('Pinned run changed providers')
ordinary=ai('openai',api_key='test',model='gpt-5.6',transport=ordinary_transport)
async_candidate=ai('openai',api_key='test',model='gpt-6-astra',transport=unused_candidate)
balanced=AxBalancer([MultiServiceRouter([{'key':'smart','service':ordinary,'model':'gpt-5.6'}]),MultiServiceRouter([{'key':'smart','service':async_candidate,'model':'gpt-6-astra'}])],{'strategy':'input_order'})
def ordinary_lookup(args):
    balanced_calls.append('done')
    return 'FALLBACK'
balanced_program=ax('question -> answer',{'functions':[fn('lookup').description('Lookup').execution('background').handler(ordinary_lookup).build()]})
assert balanced_program.forward(balanced,{'question':'Lookup'},{'model':'smart'})=={'answer':'FALLBACK'}
assert len(balanced_requests)==2 and balanced_calls==['done']
print('python mixed balancer pins ordinary-chat fallback for the entire run')

# Invalid completed arguments are corrected through the same call ID without execution.
for exhausted, raw_arguments in [(exhausted, arguments) for exhausted in (False, True) for arguments in ('{}', '{"query":"ab"}')]:
    failure_requests=[]; failure_calls=[]
    def failure_transport(req):
        failure_requests.append(req)
        if len(failure_requests)==1:
            response={'id':'invalid','model':'gpt-6-astra','output':[{'type':'function_call','id':'invalid-item','call_id':'invalid-call','name':'validated_lookup','arguments':raw_arguments}]}
        else:
            assert not exhausted and len(failure_requests)==2, 'work replayed after step exhaustion'
            body=req['json']; assert body['previous_response_id']=='invalid'
            outputs=[item for item in body['input'] if item['type']=='function_call_output']
            assert len(outputs)==1 and outputs[0]['call_id']=='invalid-call', outputs
            assert 'query' in outputs[0]['output'].lower(), outputs
            response={'id':'corrected','model':'gpt-6-astra','output':[{'type':'message','id':'corrected-msg','content':[{'type':'output_text','text':'{"answer":"CORRECTED"}'}]}]}
        return {'status':200,'body':'data: '+json.dumps({'type':'response.completed','response':response})+'\n\n'}
    failure_client=ai('openai',model='gpt-6-astra',api_key='test',transport=failure_transport)
    validated=fn('validated_lookup').description('Requires a query').arg('query',f.string()).execution('background').handler(lambda args: failure_calls.append(args)).build()
    validated.parameters = {'type': 'object', '$defs': {'query': {'type': 'string', 'minLength': 3, 'pattern': '^[A-Z]+$'}}, 'properties': {'query': {'$ref': '#/$defs/query'}}, 'required': ['query'], 'additionalProperties': False}
    failure_program=ax('question -> answer',{'functions':[validated]})
    try:
        result=failure_program.forward(failure_client,{'question':'Find reference'},{'maxSteps':1 if exhausted else 3})
        assert not exhausted and result=={'answer':'CORRECTED'}, result
    except RuntimeError as error:
        assert exhausted and 'steps' in str(error), str(error)
    assert not failure_calls, 'invalid arguments reached a handler'
    assert len(failure_requests)==(1 if exhausted else 2)
print('python invalid arguments, correction continuation, and step exhaustion passed')

# Native files survive router and balancer preprocessing and a subsequent turn.
import copy
from axllm import AxBalancer
file_requests=[]
def file_transport(request):
    file_requests.append(copy.deepcopy(request['json']))
    return {'status':200,'json':{'id':'file-response','choices':[{'index':0,'message':{'role':'assistant','content':'{"summary":"Read"}'}}]}}
def unexpected_extraction(*args):
    raise AssertionError('Native file was extracted')
file_client=ai('openai',api_key='test',model='gpt-5.6',transport=file_transport)
file_balancer=AxBalancer([file_client])
file_router=ProviderRouter({'providers':{'primary':file_balancer},'processing':{'fileToText':unexpected_extraction}})
file_item={'type':'file','filename':'report.pdf','mimeType':'application/pdf','data':'JVBERi0=','extractedText':'fallback','cache':True}
file_request={'chatPrompt':[{'role':'user','content':[{'type':'text','text':'Read'},file_item,{'type':'text','text':'Summarize'}]}],'modelConfig':{'stream':False}}
original=copy.deepcopy(file_request)
file_router.chat(file_request)
assert file_request==original, 'preprocessing mutated retained history'
file_request['chatPrompt'].extend([{'role':'assistant','content':'Read'},{'role':'user','content':'Continue'}])
file_router.chat(file_request)
for request in file_requests:
    parts=request['messages'][0]['content']
    assert parts[1]=={'type':'file','file':{'filename':'report.pdf','file_data':'data:application/pdf;base64,JVBERi0='}}, parts
    assert parts[0]['text']=='Read' and parts[2]['text']=='Summarize'
assert file_request['chatPrompt'][0]==original['chatPrompt'][0]
generated_file=ax('document:file -> summary:string').forward(file_router,{'document':file_item})
assert generated_file=={'summary':'Read'}, generated_file
assert len(file_requests)==3, 'router completion lost the final answer and retried'
print('python router and balancer native files, ordering, history, and continuation passed')

extractions=[]
def extract_file(data,mime):
    extractions.append((data,mime))
    return ''
text_client=ai('deepseek',api_key='test',model='deepseek-v4-flash',transport=file_transport)
text_router=ProviderRouter({'providers':{'primary':text_client},'processing':{'fileToText':extract_file}})
raw_file={'chatPrompt':[{'role':'user','content':[{'type':'file','mimeType':'application/pdf','data':'JVBERi0='}]}]}
text_router.chat(raw_file)
assert extractions==[('JVBERi0=','application/pdf')]
assert file_requests[-1]['messages'][0]['content']==''
def failed_file(data,mime):
    raise ValueError('extractor failed')
text_router.processing['fileToText']=failed_file
before=len(file_requests)
try:
    text_router.chat(raw_file)
    raise AssertionError('extraction failure was swallowed')
except Exception as error:
    assert isinstance(error.__cause__,ValueError), error
assert len(file_requests)==before
print('python file extraction arguments, empty results, and failure context passed')

reject_files=ProviderRouter({'providers':{'primary':text_client},'processing':{'fallbackBehavior':'error'}})
try:
    reject_files.chat(raw_file)
    raise AssertionError('error policy accepted an unsupported file')
except Exception as error:
    assert 'Files are not supported' in str(error), error
assert len(file_requests)==before

# Independent built-in clients must overlap; a serial implementation times out.
def owned_flow_overlap():
    import json, threading
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    from axllm import ai, ax, flow, MultiServiceRouter, AxBalancer, ProviderRouter
    barrier = threading.Barrier(2, timeout=3)
    requests = []
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args): pass
        def do_POST(self):
            requests.append(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
            assert self.headers['Authorization'] == 'Bearer worker-test'
            try: barrier.wait()
            except threading.BrokenBarrierError:
                self.send_error(500, 'parallel nodes did not overlap'); return
            data = json.dumps({'id':'reply','choices':[{'index':0,'message':{'role':'assistant','content':'{"answer":"DONE"}'},'finish_reason':'stop'}], 'usage':{'prompt_tokens':2,'completion_tokens':1,'total_tokens':3}}).encode()
            self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    try:
        client=ai('openai',api_key='worker-test',model='gpt-5.6',base_url=f'http://127.0.0.1:{server.server_port}')
        client=ProviderRouter({'providers':{'primary':MultiServiceRouter([{'key':'smart','service':AxBalancer([client])}])}})
        program=ax('question -> answer')
        factory=program.owned_worker_factory()
        assert factory() is not factory()
        workflow=flow().execute('first',program).execute('second',program).returns({'first':'firstResult','second':'secondResult'})
        result=workflow.forward(client,{'question':'Ready'},{'stream':False,'model':'smart'})
        assert result=={'first':{'answer':'DONE'},'second':{'answer':'DONE'}},result
        assert len(requests)==2,requests
        assert len(workflow.state['chat_log'])==2,workflow.state
        print('Python owned flow HTTP barrier passed')
    finally:
        server.shutdown();server.server_close();thread.join()

owned_flow_overlap()
# A failed parallel group retains completed nodes and returns before a host
# operation that ignores cancellation finishes. Late results cannot alter it.
def owned_flow_failure():
    import time
    from axllm import ai, ax, flow, run_control
    gate = threading.Barrier(3, timeout=3)
    release = threading.Event()
    fast_completed = threading.Event()
    late_finished = threading.Event()
    requests = []
    class Transport:
        def owned_worker_factory(self): return Transport
        def __call__(self, request):
            body = json.dumps(request['json'])
            requests.append(body)
            gate.wait()
            if 'lateAnswer' in body:
                try:
                    assert release.wait(3), 'test did not release noncooperative worker'
                    content = {'lateAnswer':'LATE'}
                finally: late_finished.set()
            elif 'failAnswer' in body:
                assert fast_completed.wait(3), 'completed sibling was not reported'
                content = {'wrong':'invalid'}
            else: content = {'fastAnswer':'DONE'}
            return {'status':200,'json':{'id':'reply','choices':[{'index':0,'message':{'role':'assistant','content':json.dumps(content)},'finish_reason':'stop'}]}}
    control=run_control()
    control.on_event(lambda event: fast_completed.set() if event['type']=='completed' and event['path']=='root/fast' else None)
    client=ai('openai',api_key='test',model='gpt-5.6',transport=Transport())
    workflow=flow().execute('fast',ax('question -> fastAnswer')).execute('fail',ax('question -> failAnswer')).execute('late',ax('question -> lateAnswer'))
    try:
        started=time.monotonic()
        try:
            workflow.forward(client,{'question':'Ready'},{'control':control,'stream':False,'maxSteps':1,'validationRetries':0,'infraRetries':0})
            raise AssertionError('Failed group returned success')
        except RuntimeError as error:
            assert 'late' in str(error),error
        assert time.monotonic()-started<2, 'Flow waited for noncooperative work'
        assert not late_finished.is_set()
        assert workflow.state['completed_state']['fastResult']=={'fastAnswer':'DONE'},workflow.state
        snapshot=json.dumps(workflow.state['completed_state'],sort_keys=True)
    finally: release.set()
    assert late_finished.wait(3)
    assert json.dumps(workflow.state['completed_state'],sort_keys=True)==snapshot
    assert len(requests)==3, 'Completed nodes or started requests were replayed'
    print('python parallel failure preserves completed state and discards late work')
owned_flow_failure()

# Concurrent native MCP invocations keep protocol IDs and tool results distinct.
from axllm.mcp import AxMCPClient, AxMCPTransport
from concurrent.futures import ThreadPoolExecutor
class ConcurrentMCPTransport(AxMCPTransport):
    def __init__(self):
        self.requests=[];self.lock=threading.Lock();self.gate=threading.Barrier(32)
    def send_notification(self,message):
        assert message['method']=='notifications/initialized'
    def send(self,message):
        method=message['method']
        if method=='server/discover':
            result={'resultType':'complete','supportedVersions':['2026-07-28'],'ttlMs':60000,'cacheScope':'private','capabilities':{'tools':{}}}
        elif method=='initialize':
            result={'protocolVersion':'2025-11-25','serverInfo':{'name':'orders','version':'1'},'capabilities':{'tools':{}}}
        elif method=='tools/list':
            result={'tools':[{'name':'lookup','inputSchema':{'type':'object','properties':{'index':{'type':'integer'}}}}]}
        else:
            assert method=='tools/call' and message['params']['name']=='lookup'
            with self.lock:self.requests.append(message)
            self.gate.wait(timeout=3)
            result={'resultType':'complete','_meta':{'io.modelcontextprotocol/serverInfo':{'name':'orders','version':message['id']}},'structuredContent':message['params']['arguments']}
        return {'jsonrpc':'2.0','id':message['id'],'result':result}
mcp_transport=ConcurrentMCPTransport();mcp_client=AxMCPClient(mcp_transport,{'era':'modern','namespace':'orders'});mcp_client.init()
mcp_native=mcp_client.native_tools()[0]
with ThreadPoolExecutor(max_workers=32) as workers:
    mcp_results=list(workers.map(lambda index:mcp_native.call({'index':index}),range(32)))
assert sorted(result['structuredContent']['index'] for result in mcp_results)==list(range(32))
assert len(mcp_transport.requests)==32 and len({request['id'] for request in mcp_transport.requests})==32
print('python concurrent native MCP identities and results passed')

# Worker failures must affect later routing by the original balancer.
def owned_balancer_failure_accounting():
    from axllm import AxBalancer
    requests=[]
    class FailingTransport:
        def owned_worker_factory(self): return FailingTransport
        def __call__(self,request):
            requests.append(request)
            return {'status':429,'json':{'error':{'message':'fixture rate limit'}}}
    owner=AxBalancer([ai('openai',api_key='test',model='gpt-5.6',transport=FailingTransport())],{'maxRetries':1,'initialBackoffMs':0})
    worker=owner.owned_worker_factory()()
    request={'chat_prompt':[{'role':'user','content':'Hello'}],'model_config':{'stream':False}}
    for current in (worker,owner):
        try: current.chat(request); raise AssertionError('Failed route returned success')
        except Exception as error:
            assert not isinstance(error,AssertionError)
        if current is worker: first_count=len(requests);assert first_count>0
    assert len(requests)==first_count,'Parent forgot worker failure and replayed the failed route'
    assert owner.get_metrics()['errors']['chat']['total']==1,owner.get_metrics()
    assert owner.get_metrics()['errors']['chat']['count']==1,owner.get_metrics()
    print('python owned balancer shares failure accounting')
owned_balancer_failure_accounting()

# An MCP-derived tool must retain its raw schema and invocation binding in an agent.
def native_mcp_agent_discovery():
    from dataclasses import replace
    from axllm import agent
    schema={'type':'object','$defs':{'reference':{'type':'string','minLength':3}},'properties':{'query':{'$ref':'#/$defs/reference'}},'required':['query'],'additionalProperties':False}
    started=threading.Event();release=threading.Event();calls=[];requests=[]
    class MCP(AxMCPTransport):
        def send_notification(self,message): raise AssertionError('Modern discovery sent initialize')
        def send(self,message):
            method=message['method']
            if method=='server/discover':result={'resultType':'complete','supportedVersions':['2026-07-28'],'ttlMs':60000,'cacheScope':'private','capabilities':{'tools':{}}}
            elif method=='tools/list':result={'tools':[{'name':'lookup','description':'Find reference','inputSchema':schema}]}
            else:
                assert method=='tools/call' and message['params']['name']=='lookup',message
                assert message['params']['arguments']=={'query':'REF-42'},message
                assert message['params']['_meta'], 'MCP invocation metadata was lost'
                calls.append(message);started.set();assert release.wait(3),'MCP tool did not overlap the model'
                result={'resultType':'complete','structuredContent':{'reference':'REF-42'},'content':[{'type':'text','text':'REF-42'}]}
            return {'jsonrpc':'2.0','id':message['id'],'result':result}
    mcp=AxMCPClient(MCP(),{'era':'modern','namespace':'orders'});mcp.init()
    native=mcp.native_tools()[0];assert native.execution=='blocking'
    native=replace(native,execution='background')
    program=agent('question -> answer',{'functions':[{'namespace':'orders','functions':[native]}],'functionDiscovery':True,'directResponse':'off'})
    hidden=True
    def model(request):
        nonlocal hidden
        body=request['json'];requests.append(body);number=len(requests)
        actor_tools=[tool for tool in body.get('tools',[]) if tool.get('async')]
        if hidden:
            assert not actor_tools,'Undiscovered MCP tool was exposed to the model'
            output='{"completion":{"type":"final","args":["No discovered tools",{}]}}' if number<3 else '{"answer":"not discovered"}'
            return {'status':200,'body':'data: '+json.dumps({'type':'response.completed','response':agent_response('hidden-'+str(number),output)})+'\n\n'}
        if number==1 or number==5:
            assert not actor_tools,'Native tool escaped executor authority'
            if number==5:assert 'REF-42' in json.dumps(body),'Responder started before the MCP result was incorporated'
            output='{"completion":{"type":"final","args":["Find reference",{}]}}' if number==1 else '{"answer":"REF-42"}'
            return {'status':200,'body':'data: '+json.dumps({'type':'response.completed','response':agent_response('stage-'+str(number),output)})+'\n\n'}
        if number==2:
            assert actor_tools[0]['name']=='orders_lookup' and actor_tools[0]['parameters']==schema,actor_tools
            item={'type':'function_call','id':'invalid','call_id':'invalid-call','name':'orders_lookup','arguments':'{"query":"X"}'}
            response={'id':'invalid-response','model':'gpt-6-astra','output':[item]}
            return {'status':200,'body':'data: '+json.dumps({'type':'response.completed','response':response})+'\n\n'}
        if number==3:
            assert not calls,'Invalid MCP arguments reached the handler'
            assert body['previous_response_id']=='invalid-response' and body['input'][-1]['call_id']=='invalid-call',body
            def events():
                yield 'data: '+json.dumps({'type':'response.output_item.done','item':{'type':'function_call','id':'valid','call_id':'mcp-call','name':'orders_lookup','arguments':'{"query":"REF-42"}'}})+'\n\n'
                assert started.wait(3);release.set()
                yield 'data: '+json.dumps({'type':'response.completed','response':agent_response('tool-response','{"completion":{"type":"final","args":["Report",{"answer":"provisional"}]}}')})+'\n\n'
            return {'status':200,'body':events()}
        assert number==4 and body['previous_response_id']=='tool-response',body
        result=body['input'][-1];assert result['call_id']=='mcp-call' and json.loads(result['output'])['structuredContent']['reference']=='REF-42',result
        return {'status':200,'body':'data: '+json.dumps({'type':'response.completed','response':agent_response('final-response','{"completion":{"type":"final","args":["Report",{"answer":"REF-42"}]}}')})+'\n\n'}
    def transport(request):
        response=model(request)
        if not request.get('stream') and isinstance(response.get('body'),str):
            response['json']=json.loads(response['body'].removeprefix('data: '))['response']
        return response
    client=ai('openai',model='gpt-6-astra',api_key='test',transport=transport)
    assert program.forward(client,{'question':'Find reference'})=={'answer':'not discovered'}
    assert not calls and len(requests)==3
    program.discover({'tools':['orders']});hidden=False;requests.clear()
    assert program.forward(client,{'question':'Find reference'})=={'answer':'REF-42'}
    assert len(calls)==1 and len(requests)==5
    activity=[entry for entry in program.state['action_log'] if entry.get('type')=='function_call']
    assert any(entry.get('qualified_name')=='orders.lookup' and entry.get('call_id')=='mcp-call' and entry.get('status')=='ok' for entry in activity),activity
    assert program.invoke_callable('orders.lookup',{'query':'REF-42'})['status']=='error'
    assert len(calls)==1,'MCP native call was replayed through actor code'
    print('python discovered MCP native agent schema, correction, overlap, result and action log passed')
native_mcp_agent_discovery()
