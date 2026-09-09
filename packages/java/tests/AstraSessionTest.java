import dev.axllm.ax.*;
import java.io.*;
import java.net.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

public final class AstraSessionTest {
  static void manualClockDeadline() throws Exception {
    var clock = new AxEventClock.ManualClock(0);
    var token = new AxCancellationToken() {
      @Override public Subscription subscribe(Runnable callback) {
        var subscription = super.subscribe(callback);
        clock.advance(1);
        return subscription;
      }
    };
    var success = new java.util.concurrent.atomic.AtomicBoolean();
    var sleeper = new Thread(() -> { try { success.set(clock.sleep(1, token)); } catch (InterruptedException error) { Thread.currentThread().interrupt(); } });
    sleeper.start(); sleeper.join(1000);
    try {
      if (sleeper.isAlive() || !success.get() || token.subscriptionCount() != 0) throw new AssertionError("Manual clock deadline raced with subscription");
    } finally { token.cancel(); sleeper.join(1000); }
  }
  @SuppressWarnings("unchecked") static void nativeFiles() throws Exception {
    var requests=new ArrayList<Map<String,Object>>();
    OpenAICompatibleClient.Transport transport=request->{requests.add((Map<String,Object>)request.get("json"));return Map.of("status",200,"json",Map.of("id","file-response","choices",List.of(Map.of("index",0,"message",Map.of("role","assistant","content","{\"summary\":\"Read\"}")))));};
    var client=Ax.ai("openai",Map.of("api_key","test","model","gpt-5.6","transport",transport));
    var balancer=new AxBalancer(List.of(client));
    AxProviderRouter.FileToText extractor=(data,mime)->{throw new AssertionError("Native file extracted");};
    var router=new AxProviderRouter(Map.of("providers",Map.of("primary",balancer),"processing",Map.of("fileToText",extractor)));
    var message=Map.of("role","user","content",List.of(Map.of("type","text","text","Read"),Map.of("type","file","filename","report.pdf","mimeType","application/pdf","data","JVBERi0=","cache",true,"extractedText","fallback"),Map.of("type","text","text","Summarize")));
    String original=Json.stringify(message);
    var prompt=new ArrayList<Object>();prompt.add(message);
    var request=new LinkedHashMap<String,Object>();request.put("chatPrompt",prompt);request.put("modelConfig",Map.of("stream",false));
    router.chat(request,Map.of());
    prompt.add(Map.of("role","assistant","content","Read"));prompt.add(Map.of("role","user","content","Continue"));
    router.chat(request,Map.of());
    if(!original.equals(Json.stringify(message))||requests.size()!=2)throw new AssertionError("History mutated or request replayed");
    for(var body:requests){
      var parts=(List<Map<String,Object>>)((Map<String,Object>)((List<?>)body.get("messages")).get(0)).get("content");
      if(!parts.get(1).equals(Map.of("type","file","file",Map.of("filename","report.pdf","file_data","data:application/pdf;base64,JVBERi0=")))||!"Read".equals(parts.get(0).get("text"))||!"Summarize".equals(parts.get(2).get("text")))throw new AssertionError("Native file or ordering lost: "+parts);
    }
    var generated=Ax.ax("document:file -> summary:string").forward(router,Map.of("document",Map.of("filename","report.pdf","mimeType","application/pdf","data","JVBERi0=")));
    if(!"Read".equals(generated.get("summary"))||requests.size()!=3)throw new AssertionError("Router lost generator completion");
    requests.clear();
    var textClient=Ax.ai("deepseek",Map.of("api_key","test","model","deepseek-v4-flash","transport",transport));
    AxProviderRouter.FileToText extract=(data,mime)->{if(!"JVBERi0=".equals(data)||!"application/pdf".equals(mime))throw new AssertionError("Extraction arguments lost");return "";};
    var processing=new HashMap<String,Object>();processing.put("fileToText",extract);
    var textRouter=new AxProviderRouter(Map.of("providers",Map.of("primary",textClient),"processing",processing));
    var rawFile=Map.<String,Object>of("chatPrompt",List.of(Map.of("role","user","content",List.of(Map.of("type","file","data","JVBERi0=","mimeType","application/pdf")))));
    textRouter.chat(rawFile,Map.of());
    if(!"".equals(((Map<?,?>)((List<?>)requests.get(0).get("messages")).get(0)).get("content")))throw new AssertionError("Empty extraction lost");
    AxProviderRouter.FileToText fail=(data,mime)->{throw new IOException("extractor failed");};
    var failingRouter=new AxProviderRouter(Map.of("providers",Map.of("primary",textClient),"processing",Map.of("fileToText",fail)));
    try{failingRouter.chat(rawFile,Map.of());throw new AssertionError("Extraction failure swallowed");}catch(IllegalStateException error){if(!(error.getCause() instanceof IOException))throw error;}
    if(requests.size()!=1)throw new AssertionError("Failed extraction reached transport");
    var rejectFiles=new AxProviderRouter(Map.of("providers",Map.of("primary",textClient),"processing",Map.of("fallbackBehavior","error")));
    try{rejectFiles.chat(rawFile,Map.of());throw new AssertionError("Error policy accepted unsupported file");}catch(AxAIServiceError error){if(!error.getMessage().contains("Files are not supported"))throw error;}
    if(requests.size()!=1)throw new AssertionError("Unsupported file reached transport");
    System.out.println("java router and balancer native files, history, and continuation passed");
  }
  private static void emit(OutputStream output,Object event) throws IOException { output.write(("data: "+Json.stringify(event)+"\n\n").getBytes(StandardCharsets.UTF_8));output.flush(); }
  private static Map<String,Object> completed(String id,String answer) {return Map.of("type","response.completed","response",Map.of("id",id,"model","gpt-6-astra","output",List.of(Map.of("type","message","id","msg-"+id,"content",List.of(Map.of("type","output_text","text",answer))))));}
  static void ownedFlowOverlap() throws Exception {
    var barrier=new CyclicBarrier(2);var requests=new java.util.concurrent.CopyOnWriteArrayList<Object>();
    var server=com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1",0),0);
    var executor=Executors.newCachedThreadPool();server.setExecutor(executor);
    server.createContext("/",exchange->{try{
      if(!"Bearer worker-test".equals(exchange.getRequestHeaders().getFirst("Authorization")))throw new AssertionError("Worker lost authentication");
      requests.add(Json.parse(new String(exchange.getRequestBody().readAllBytes(),StandardCharsets.UTF_8)));
      barrier.await(3,TimeUnit.SECONDS);
      byte[] body=Json.stringify(Map.of("id","reply","choices",List.of(Map.of("index",0,"message",Map.of("role","assistant","content","{\"answer\":\"DONE\"}"),"finish_reason","stop")),"usage",Map.of("prompt_tokens",2,"completion_tokens",1,"total_tokens",3))).getBytes(StandardCharsets.UTF_8);
      exchange.getResponseHeaders().set("Content-Type","application/json");exchange.sendResponseHeaders(200,body.length);exchange.getResponseBody().write(body);
    }catch(Exception error){exchange.sendResponseHeaders(500,0);}finally{exchange.close();}});
    server.start();try{
      var client=Ax.ai("openai",Map.of("api_key","worker-test","model","gpt-5.6","base_url","http://127.0.0.1:"+server.getAddress().getPort()));
      var aliases=new AxMultiServiceRouter(List.of(new AxMultiServiceRouter.Entry("smart",new AxBalancer(List.of(client)),"Worker alias")));
      var router=new AxProviderRouter(Map.of("providers",Map.of("primary",aliases)));
      var program=Ax.ax("question -> answer");
      if(program.ownedWorkerFactory().get()==program.ownedWorkerFactory().get())throw new AssertionError("Program workers share state");
      var workflow=Ax.flow().execute("first",program).execute("second",program).returns(Map.of("first","firstResult","second","secondResult"));
      var result=workflow.forward(router,Map.of("question","Ready"),Map.of("stream",false,"model","smart"));
      if(!result.equals(Map.of("first",Map.of("answer","DONE"),"second",Map.of("answer","DONE")))||requests.size()!=2||workflow.getChatLog().size()!=2)throw new AssertionError("Owned flow result or history incorrect: "+result);
    }finally{server.stop(0);executor.shutdownNow();}
    System.out.println("java owned flow HTTP barrier passed");
  }
  static void ownedBalancerFailureAccounting() throws Exception {
    var calls=new AtomicInteger();
    class FailingTransport implements OpenAICompatibleClient.Transport {
      public java.util.function.Supplier<OpenAICompatibleClient.Transport> ownedWorkerFactory(){return FailingTransport::new;}
      public Object call(Map<String,Object> request){calls.incrementAndGet();return Map.of("status",429,"json",Map.of("error",Map.of("message","fixture rate limit")));}
    }
    var owner=new AxBalancer(List.of(Ax.ai("openai",Map.of("api_key","test","model","gpt-5.6","transport",new FailingTransport()))),Map.of("maxRetries",1,"initialBackoffMs",0));
    var worker=owner.ownedWorkerFactory().get();var request=Map.<String,Object>of("chat_prompt",List.of(Map.of("role","user","content","Hello")),"model_config",Map.of("stream",false));
    try{worker.chat(request);throw new AssertionError("Failed route returned success");}catch(Exception expected){}
    int first=calls.get();if(first==0)throw new AssertionError("No provider request");
    try{owner.chat(request);throw new AssertionError("Failed parent route returned success");}catch(Exception expected){}
    if(calls.get()!=first)throw new AssertionError("Parent forgot worker failure and replayed route");
    System.out.println("java owned balancer shares failure accounting");
  }
  @SuppressWarnings("unchecked") static void nativeMCPAgentDiscovery() throws Exception {
    var schema=(Map<String,Object>)Json.parse("{\"type\":\"object\",\"$defs\":{\"reference\":{\"type\":\"string\",\"minLength\":3,\"pattern\":\"^(?=REF-[0-9]+$)(?<ref>REF)-[0-9]+$\"}},\"properties\":{\"query\":{\"$ref\":\"#/$defs/reference\"}},\"required\":[\"query\"],\"additionalProperties\":false}");
    var started=new CountDownLatch(1);var release=new CountDownLatch(1);var calls=new CopyOnWriteArrayList<Map<String,Object>>();var requests=new ArrayList<Map<String,Object>>();var hidden=new java.util.concurrent.atomic.AtomicBoolean(true);
    AxMCPTransport mcpTransport=new AxMCPTransport(){
      public void sendNotification(Map<String,Object> message){throw new AssertionError("Modern discovery initialized");}
      public Map<String,Object> send(Map<String,Object> message){
        String method=String.valueOf(message.get("method"));Object result;
        if(method.equals("server/discover"))result=Map.of("resultType","complete","supportedVersions",List.of("2026-07-28"),"ttlMs",60000,"cacheScope","private","capabilities",Map.of("tools",Map.of()));
        else if(method.equals("tools/list"))result=Map.of("tools",List.of(Map.of("name","lookup","description","Find reference","inputSchema",schema)));
        else {var params=(Map<String,Object>)message.get("params");if(!method.equals("tools/call")||!"lookup".equals(params.get("name"))||!Map.of("query","REF-42").equals(params.get("arguments"))||!(params.get("_meta") instanceof Map))throw new AssertionError("Lost MCP invocation: "+message);calls.add(message);started.countDown();try{if(!release.await(3,TimeUnit.SECONDS))throw new AssertionError("MCP tool did not overlap model");}catch(InterruptedException error){throw new RuntimeException(error);}result=Map.of("resultType","complete","structuredContent",Map.of("reference","REF-42"),"content",List.of(Map.of("type","text","text","REF-42")));}
        return Map.of("jsonrpc","2.0","id",message.get("id"),"result",result);
      }
    };
    var allowed=new java.util.concurrent.atomic.AtomicBoolean();var authorizations=new AtomicInteger();var clientRef=new java.util.concurrent.atomic.AtomicReference<AxMCPClient>();
    java.util.function.Predicate<Map<String,Object>> authorize=call->{if(call.get("client")!=clientRef.get()||!"orders".equals(call.get("namespace"))||!schema.equals(((Map<?,?>)call.get("tool")).get("inputSchema"))||!Map.of("query","REF-42").equals(call.get("arguments")))throw new AssertionError("Lost MCP authorization context");authorizations.incrementAndGet();return allowed.get();};
    var mcp=new AxMCPClient(mcpTransport,Map.of("era","modern","namespace","orders","authorizeToolCall",authorize));clientRef.set(mcp);mcp.init();var original=mcp.nativeTools().get(0);if(!"blocking".equals(original.execution))throw new AssertionError("MCP hint enabled background work");
    try{original.handler.call(Map.of("query","REF-42"));throw new AssertionError("Denied MCP tool executed");}catch(RuntimeException error){if(!error.getMessage().contains("MCP tool call denied by host policy: lookup"))throw error;}if(!calls.isEmpty())throw new AssertionError("Denied MCP request reached transport");allowed.set(true);
    var nativeTool=Ax.fn(original.name).description(original.description).parameters(original.schema()).execution("background").handler(original.handler).build();
    var program=Ax.agent("question -> answer",Map.of("functions",List.of(Map.of("namespace","orders","functions",List.of(nativeTool))),"functionDiscovery",true,"directResponse","off"));
    OpenAICompatibleClient.Transport transport=new OpenAICompatibleClient.Transport(){
      public Object call(Map<String,Object> request)throws Exception{return event(request,false);}
      public Object stream(Map<String,Object> request)throws Exception{return event(request,true);}
      private Object event(Map<String,Object> request,boolean streaming)throws Exception {
        var body=(Map<String,Object>)request.get("json");requests.add(body);int number=requests.size();var tools=(List<Map<String,Object>>)body.getOrDefault("tools",List.of());var actor=tools.stream().filter(tool->Boolean.TRUE.equals(tool.get("async"))).toList();Map<String,Object> event;
        if(hidden.get()){
          if(!actor.isEmpty())throw new AssertionError("Undiscovered tool exposed");event=completed("hidden-"+number,number<3?"{\"completion\":{\"type\":\"final\",\"args\":[\"No discovered tools\",{}]}}":"{\"answer\":\"not discovered\"}");
        }else if(number==1||number==5){
          if(!actor.isEmpty())throw new AssertionError("Native authority escaped executor");if(number==5&&!Json.stringify(body).contains("REF-42"))throw new AssertionError("Responder preceded result incorporation");event=completed("stage-"+number,number==1?"{\"completion\":{\"type\":\"final\",\"args\":[\"Find reference\",{}]}}":"{\"answer\":\"REF-42\"}");
        }else if(number==2){
          if(actor.size()!=1||!"orders_lookup".equals(actor.get(0).get("name"))||!schema.equals(actor.get(0).get("parameters")))throw new AssertionError("Lost native MCP schema: "+actor);
          event=Map.of("type","response.completed","response",Map.of("id","invalid-response","model","gpt-6-astra","output",List.of(Map.of("type","function_call","id","invalid","call_id","invalid-call","name","orders_lookup","arguments","{\"query\":\"X\"}"))));
        }else if(number==3){
          if(!calls.isEmpty()||!"invalid-response".equals(body.get("previous_response_id")))throw new AssertionError("Invalid args reached MCP or lost correction");
          var pipe=new java.io.PipedInputStream();var writer=new java.io.PipedOutputStream(pipe);new Thread(()->{try(writer){writer.write(("data: "+Json.stringify(Map.of("type","response.output_item.done","item",Map.of("type","function_call","id","valid","call_id","mcp-call","name","orders_lookup","arguments","{\"query\":\"REF-42\"}")))+"\n\n").getBytes(java.nio.charset.StandardCharsets.UTF_8));writer.flush();if(!started.await(3,TimeUnit.SECONDS))throw new AssertionError("MCP tool did not start");release.countDown();writer.write(("data: "+Json.stringify(completed("tool-response","{\"completion\":{\"type\":\"final\",\"args\":[\"Report\",{\"answer\":\"provisional\"}]}}"))+"\n\n").getBytes(java.nio.charset.StandardCharsets.UTF_8));}catch(Exception error){throw new RuntimeException(error);}},"mcp-agent-fixture").start();return pipe;
        }else{
          if(number!=4||!"tool-response".equals(body.get("previous_response_id")))throw new AssertionError("Unexpected continuation");var input=(List<Map<String,Object>>)body.get("input");var result=input.get(input.size()-1);if(!"mcp-call".equals(result.get("call_id"))||!Json.stringify(Json.parse(String.valueOf(result.get("output")))).contains("REF-42"))throw new AssertionError("MCP result lost");event=completed("final-response","{\"completion\":{\"type\":\"final\",\"args\":[\"Report\",{\"answer\":\"REF-42\"}]}}");
        }
        return streaming?"data: "+Json.stringify(event)+"\n\n":Map.of("status",200,"json",event.get("response"));
      }
    };
    var client=Ax.ai("openai",Map.of("api_key","test","model","gpt-6-astra","transport",transport));
    if(!"not discovered".equals(program.forward(client,Map.of("question","Find reference")).get("answer"))||!calls.isEmpty()||requests.size()!=3)throw new AssertionError("Discovery boundary failed");
    program.discover(Map.of("tools",List.of("orders")));hidden.set(false);requests.clear();
    if(!"REF-42".equals(program.forward(client,Map.of("question","Find reference")).get("answer"))||calls.size()!=1||requests.size()!=5)throw new AssertionError("Native MCP execution failed");
    boolean recorded=program.getActionLog().stream().anyMatch(entry->entry instanceof Map<?,?> record&&"orders.lookup".equals(record.get("qualified_name"))&&"mcp-call".equals(record.get("call_id"))&&"ok".equals(record.get("status")));if(!recorded)throw new AssertionError("Native MCP activity missing");
    var duplicate=(Map<String,Object>)program.invokeCallable("orders.lookup",Map.of("query","REF-42"));if(!"error".equals(duplicate.get("status"))||calls.size()!=1)throw new AssertionError("Native MCP call replayed through actor");
    if(authorizations.get()!=2)throw new AssertionError("Invalid arguments or actor replay reached authorization");
    System.out.println("java discovered MCP native agent schema, correction, overlap, result and action log passed");
  }
  static void ownedFlowFailure() throws Exception {
    var gate=new CyclicBarrier(3);var release=new CountDownLatch(1);var fast=new CountDownLatch(1);var late=new CountDownLatch(1);var requests=new AtomicInteger();
    class Transport implements OpenAICompatibleClient.Transport {
      public java.util.function.Supplier<OpenAICompatibleClient.Transport> ownedWorkerFactory(){return Transport::new;}
      public Object call(Map<String,Object> request)throws Exception {
        String body=Json.stringify(request.get("json"));requests.incrementAndGet();gate.await(3,TimeUnit.SECONDS);String content="{\"fastAnswer\":\"DONE\"}";
        if(body.contains("lateAnswer")){
          // Deliberately ignore interrupts to exercise retained worker ownership.
          long deadline=System.nanoTime()+3_000_000_000L;while(release.getCount()!=0&&System.nanoTime()<deadline){try{release.await(20,TimeUnit.MILLISECONDS);}catch(InterruptedException ignored){}}
          if(release.getCount()!=0)throw new AssertionError("Late worker was not released");content="{\"lateAnswer\":\"LATE\"}";late.countDown();
        }else if(body.contains("failAnswer")){if(!fast.await(3,TimeUnit.SECONDS))throw new AssertionError("Completed sibling was not reported");content="{\"wrong\":\"invalid\"}";}
        return Map.of("status",200,"json",Map.of("id","reply","choices",List.of(Map.of("index",0,"message",Map.of("role","assistant","content",content),"finish_reason","stop"))));
      }
    }
    var control=Ax.runControl();control.onEvent(event->{if("completed".equals(event.get("type"))&&"root/fast".equals(event.get("path")))fast.countDown();});
    var client=Ax.ai("openai",Map.of("api_key","test","model","gpt-5.6","transport",new Transport()));
    var workflow=Ax.flow().execute("fast",Ax.ax("question -> fastAnswer")).execute("fail",Ax.ax("question -> failAnswer")).execute("late",Ax.ax("question -> lateAnswer"));
    String snapshot;
    try{
      long started=System.nanoTime();
      try{workflow.forward(client,Map.of("question","Ready"),Map.of("control",control,"stream",false,"maxSteps",1,"validationRetries",0,"infraRetries",0));throw new AssertionError("Failed group returned success");}
      catch(RuntimeException error){if(!error.toString().contains("late"))throw new AssertionError("Unresolved node missing",error);}
      if(System.nanoTime()-started>2_000_000_000L||late.getCount()==0)throw new AssertionError("Flow waited for noncooperative work");
      snapshot=Json.stringify(workflow.getChatLog());if(!snapshot.contains("DONE")||snapshot.contains("LATE"))throw new AssertionError("Lost completed sibling diagnostics: "+snapshot);
    }finally{release.countDown();}
    if(!late.await(3,TimeUnit.SECONDS)||requests.get()!=3||!snapshot.equals(Json.stringify(workflow.getChatLog())))throw new AssertionError("Late work changed state or requests were replayed");
    System.out.println("java parallel failure preserves completed state and discards late work");
  }

  @SuppressWarnings("unchecked") static void concurrentNativeMCP() throws Exception {
    var requests=new CopyOnWriteArrayList<Map<String,Object>>();var barrier=new CyclicBarrier(32);
    AxMCPTransport transport=new AxMCPTransport(){
      public void sendNotification(Map<String,Object> message){if(!"notifications/initialized".equals(message.get("method")))throw new AssertionError(message);}
      public Map<String,Object> send(Map<String,Object> message){
        String method=String.valueOf(message.get("method"));Object result;
        if(method.equals("server/discover"))result=Map.of("resultType","complete","supportedVersions",List.of("2026-07-28"),"ttlMs",60000,"cacheScope","private","capabilities",Map.of("tools",Map.of()));
        else if(method.equals("initialize"))result=Map.of("protocolVersion","2025-11-25","serverInfo",Map.of("name","orders","version","1"),"capabilities",Map.of("tools",Map.of()));
        else if(method.equals("tools/list"))result=Map.of("tools",List.of(Map.of("name","lookup","inputSchema",Map.of("type","object","properties",Map.of("index",Map.of("type","integer"))))));
        else {var params=(Map<String,Object>)message.get("params");if(!method.equals("tools/call")||!"lookup".equals(params.get("name")))throw new AssertionError(message);requests.add(message);try{barrier.await(3,TimeUnit.SECONDS);}catch(Exception error){throw new RuntimeException(error);}result=Map.of("resultType","complete","_meta",Map.of("io.modelcontextprotocol/serverInfo",Map.of("name","orders","version",message.get("id"))),"structuredContent",params.get("arguments"));}
        return Map.of("jsonrpc","2.0","id",message.get("id"),"result",result);
      }
    };
    var client=new AxMCPClient(transport,Map.of("era","modern","namespace","orders"));client.init();var nativeTool=client.nativeTools().get(0);
    var pool=Executors.newFixedThreadPool(32);
    try {var results=new ArrayList<Future<Object>>();for(int index=0;index<32;index++){final int value=index;results.add(pool.submit(()->nativeTool.call(Map.of("index",value))));}
      for(int index=0;index<32;index++){var result=(Map<String,Object>)results.get(index).get(5,TimeUnit.SECONDS);if(!Integer.valueOf(index).equals(((Map<String,Object>)result.get("structuredContent")).get("index")))throw new AssertionError(result);}
    } finally {pool.shutdownNow();if(!pool.awaitTermination(5,TimeUnit.SECONDS))throw new AssertionError("MCP workers did not stop");}
    if(requests.size()!=32||requests.stream().map(value->value.get("id")).distinct().count()!=32)throw new AssertionError("Duplicate native MCP request IDs");
    System.out.println("java concurrent native MCP identities and results passed");
  }
  @SuppressWarnings("unchecked") static void ownedChildControls() throws Exception {
    var stages=List.of("root/distiller","root/executor","root/team.researcher/distiller","root/team.researcher/executor","root/team.researcher/responder","root/executor","root/responder");
    for(boolean cancel:List.of(false,true)) {
      var control=Ax.runControl();var observed=Collections.synchronizedList(new ArrayList<Map<String,Object>>());var requests=new ArrayList<Map<String,Object>>();
      control.onEvent(observed::add);
      control.steer("ROOT-UPDATE");control.steer("CHILD-ONLY","root/team.researcher");control.setThinkingTokenBudget("medium","root/team.researcher/executor");
      class Runtime implements AxCodeRuntime {
        boolean delegated;int closed;
        Map<String,AxCodeRuntime.HostCallable> callbacks=new LinkedHashMap<>();
        public void registerHostCallable(String name,AxCodeRuntime.HostCallable callback){callbacks.put(name,callback);}
        public AxCodeSession createSession(Map<String,Object> globals,Map<String,Object> options){return new AxCodeSession(){
          public Object execute(String code,Map<String,Object> opts){
            if(code.equals("delegate")){delegated=true;return Map.of("callable",Map.of("qualified_name","team.researcher","args",Map.of("question","Find reference"),"call_id","child-call"));}
            return Map.of("type","final","args",List.of("Find reference",Map.of()));
          }
          public Object snapshotGlobals(Map<String,Object> opts){return Map.of("globals",Map.of());}
          public Object patchGlobals(Object snapshot,Map<String,Object> opts){return snapshot;}
          public Object close(){closed++;return Map.of("closed",true);}
        };}
      }
      var runtime=new Runtime();
      OpenAICompatibleClient.Transport transport=request->{
        var body=(Map<String,Object>)request.get("json");int number=requests.size();String stage=stages.get(number/2);requests.add(body);
        if(number%2==1){
          String input=Json.stringify(body.get("input"));
          if(!("child-r"+number).equals(body.get("previous_response_id"))||!input.contains("ROOT-UPDATE")||input.contains("CHILD-ONLY")!=stage.startsWith("root/team.researcher"))throw new AssertionError("Child control scope lost: "+body);
          var updates=((List<Map<String,Object>>)body.get("input")).stream().filter(item->"configuration_update".equals(item.get("type"))).toList();
          if(!updates.isEmpty()!=stage.equals("root/team.researcher/executor"))throw new AssertionError("Reasoning scope lost");
          if(!updates.isEmpty()&&!updates.equals(List.of(Map.of("type","configuration_update","reasoning",Map.of("effort","medium")))))throw new AssertionError("Reasoning value lost");
          if(!Objects.equals(body.get("reasoning"),requests.get(number-1).get("reasoning")))throw new AssertionError("Cache prefix changed");
        }else if(body.containsKey("previous_response_id"))throw new AssertionError("Child inherited conversation");
        if(number==10&&!Json.stringify(body).contains("REF-42"))throw new AssertionError("Parent continued without child result");
        Object output;
        if(stage.startsWith("root/team.researcher"))output=stage.endsWith("/responder")?Map.of("answer","REF-42"):Map.of("completion",Map.of("type","final","args",List.of("Find reference",Map.of())));
        else if(stage.equals("root/responder"))output=Map.of("answer","REF-42");
        else output=Map.of("javascriptCode",stage.equals("root/executor")&&!runtime.delegated?"delegate":"parent-final");
        var response=new LinkedHashMap<String,Object>(Map.of("id","child-r"+(number+1),"model","gpt-6-astra","usage",Map.of("input_tokens",2,"output_tokens",1,"total_tokens",3),"output",List.of(Map.of("type","message","id","message","content",List.of(Map.of("type","output_text","text",Json.stringify(output)))))));
        if(cancel&&number==6)response.put("output",List.of(Map.of("type","function_call","name","tools_lookup","call_id","child-mcp","arguments","{}","status","completed")));
        return new ByteArrayInputStream(("data: "+Json.stringify(Map.of("type","response.completed","response",response))+"\n\n").getBytes(StandardCharsets.UTF_8));
      };
      var mcpCalls=new AtomicInteger();var settled=new CountDownLatch(1);
      AxMCPTransport mcpTransport=new AxMCPTransport(){
        public void sendNotification(Map<String,Object> message){}
        public Map<String,Object> send(Map<String,Object> message){
          var result="initialize".equals(message.get("method"))?Map.of("protocolVersion","2025-11-25","serverInfo",Map.of("name","fixture","version","1"),"capabilities",Map.of("tools",Map.of())):Map.of("tools",List.of(Map.of("name","lookup","inputSchema",Map.of("type","object","additionalProperties",false))));
          return Map.of("jsonrpc","2.0","id",message.get("id"),"result",result);
        }
        public Map<String,Object> sendWithContext(Map<String,Object> message,Map<String,String> headers,java.util.function.BooleanSupplier cancelled){
          if(!"tools/call".equals(message.get("method")))return AxMCPTransport.super.sendWithContext(message,headers,cancelled);
          if(!"lookup".equals(((Map<?,?>)message.get("params")).get("name")))throw new AssertionError("Wrong delegated tool");
          mcpCalls.incrementAndGet();control.abort();long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(1);
          while(!cancelled.getAsBoolean()&&System.nanoTime()<deadline)Thread.onSpinWait();
          if(!cancelled.getAsBoolean())throw new AssertionError("Child MCP cancellation did not propagate");
          settled.countDown();throw new AxAIServiceAbortedError("Child MCP invocation aborted");
        }
      };
      var mcp=new AxMCPClient(mcpTransport,Map.of("era","legacy","namespace","inventory"));mcp.init();var imported=mcp.nativeTools().get(0);
      var childOptions=new LinkedHashMap<String,Object>(Map.of("directResponse","off"));
      if(cancel){childOptions.put("functionDiscovery",false);childOptions.put("functions",List.of(Ax.fn(imported.name).description("Lookup").parameters(imported.schema()).execution("background").contextHandler(imported::call).build()));}
      var child=Ax.agent("question -> answer",childOptions);
      var parent=Ax.agent("question -> answer",Map.of("directResponse","off","runtime",runtime)).addChildAgent("team","researcher",child);
      var client=Ax.ai("openai",Map.of("api_key","test","model","gpt-6-astra","transport",transport));
      try {
        var result=parent.forward(client,Map.of("question","Find reference"),Map.of("control",control));
        if(cancel||!result.equals(Map.of("answer","REF-42"))||requests.size()!=14)throw new AssertionError("Child completion failed");
        if(observed.stream().filter(event->"applied".equals(event.get("type"))).count()!=11)throw new AssertionError("Control duplicated or lost");
        if(!((Map<?,?>)parent.getUsage().get("children")).get("team.researcher").equals(child.getUsage()))throw new AssertionError("Child usage lost");
      }catch(RuntimeException error){if(!cancel)throw error;if(!error.toString().toLowerCase().contains("abort")||(requests.size()<6||requests.size()>7)||runtime.closed!=1)throw new AssertionError("Child cancellation cleanup failed",error);}
      if(cancel&&(!settled.await(1,TimeUnit.SECONDS)||mcpCalls.get()!=1))throw new AssertionError("Child MCP work leaked or replayed");
      var calls=parent.getActionLog().stream().filter(item->item instanceof Map<?,?> record&&"child-call".equals(record.get("call_id"))).toList();
      if(calls.size()!=1||!(cancel?"error":"ok").equals(((Map<?,?>)calls.get(0)).get("status")))throw new AssertionError("Child action missing or duplicated");
      if(!((Map<?,?>)parent.getUsage().get("children")).get("team.researcher").equals(child.getUsage()))throw new AssertionError("Child failure usage lost");
      for(String name:List.of("team.researcher","llmQuery")){try{runtime.callbacks.get(name).call(Map.of("question","Late request"));throw new AssertionError("Late callback executed");}catch(RuntimeException error){if(!error.getMessage().contains("closed run"))throw error;}}
      try{parent.invokeCallable("team.researcher",Map.of("question","Find reference"));throw new AssertionError("Parent retained active client");}catch(RuntimeException error){if(!error.getMessage().contains("active parent forward"))throw error;}
    }
    System.out.println("java actual child delegation, scoped controls, usage, and cancellation passed");
  }
  public static void main(String[] args) throws Exception {
    mcpContextCancellation();
    nativeAgentMCPCancellation();
    ownedChildControls();
    ownedFlowFailure();ownedBalancerFailureAccounting();
    ownedFlowOverlap();
    manualClockDeadline();
    nativeFiles();nativeMCPAgentDiscovery();
    CountDownLatch started=new CountDownLatch(1),release=new CountDownLatch(1);
    AtomicInteger calls=new AtomicInteger(),requests=new AtomicInteger();
    OpenAICompatibleClient.Transport transport=new OpenAICompatibleClient.Transport(){
      public Object call(Map<String,Object> request){throw new AssertionError("Expected incremental HTTP transport");}
      @SuppressWarnings("unchecked") public Object stream(Map<String,Object> request) throws Exception {
        Map<String,Object> body=(Map<String,Object>)request.get("json");
        int number=requests.incrementAndGet();
        if(number==1){
          var tools=(List<Map<String,Object>>)body.get("tools");
          if(!Boolean.TRUE.equals(tools.get(0).get("async")))throw new AssertionError("Background tool was not declared async");
          var input=new PipedInputStream(8192);var output=new PipedOutputStream(input);
          Thread reader=new Thread(()->{try(output){
            emit(output,Map.of("type","response.created","response",Map.of("id","r1")));
            emit(output,Map.of("type","response.function_call_arguments.delta","delta","{","item_id","i1"));
            if(calls.get()!=0)throw new AssertionError("Partial arguments executed a tool");
            var call=Map.of("type","response.output_item.done","item",Map.of("type","function_call","id","i1","call_id","c1","name","lookup","arguments","{}"));
            emit(output,call);emit(output,call);
            if(!started.await(5,TimeUnit.SECONDS))throw new AssertionError("Tool did not start while model work was pending");
            release.countDown();emit(output,completed("r1","{\"answer\":\"provisional\"}"));
          }catch(Exception error){throw new RuntimeException(error);}});reader.setDaemon(true);reader.start();return input;
        }
        if(number!=2)throw new AssertionError("Unexpected replay");
        if(!"r1".equals(body.get("previous_response_id")))throw new AssertionError("Lost response ID");
        var expected=List.of(Map.of("type","function_call_output","call_id","c1","output","REF-42"));
        if(!expected.equals(body.get("input")))throw new AssertionError("Result was not incorporated exactly once: "+body.get("input"));
        return "data: "+Json.stringify(completed("r2","{\"answer\":\"REF-42\"}"))+"\n\n";
      }
    };
    AiClient client=Ax.ai("openai",Map.of("api_key","test","model","gpt-6-astra","transport",transport,"model_config",Map.of("thinkingTokenBudget","low")));
    Tool tool=Ax.fn("lookup").description("Look up a reference").execution("background").handler(values->{calls.incrementAndGet();started.countDown();if(!release.await(5,TimeUnit.SECONDS))throw new AssertionError("Model work did not overlap the tool");return "REF-42";}).build();
    var program=Ax.ax("question -> answer").addTool(tool);
    var routed=new AxProviderRouter(Map.of("providers",Map.of("primary",client)));
    var result=program.forward(routed,Map.of("question","Find reference"));
    if(!"REF-42".equals(result.get("answer")) || calls.get()!=1)throw new AssertionError("Invalid final result: "+result);
    System.out.println("java high-level async overlap and final incorporation passed");
    invalidArgumentsAndExhaustion();
    flowIsolation();
    nativeSteering();bufferedSteeringBoundary();
    cancellation();
    noncooperativeCancellation();
    stalledHttpCancellation();
    mixedBalancer();
    nativeAgent();
    concurrentNativeMCP();
  }
  @SuppressWarnings("unchecked") static void invalidArgumentsAndExhaustion() {
    for(boolean exhausted:List.of(false,true)) for(String rawArguments:List.of("{}", "{\"query\":\"ab\"}")) {
      var requests=new AtomicInteger();var calls=new AtomicInteger();
      OpenAICompatibleClient.Transport transport=new OpenAICompatibleClient.Transport(){
        public Object call(Map<String,Object> request){throw new AssertionError("Expected streaming");}
        public Object stream(Map<String,Object> request){int n=requests.incrementAndGet();Map<String,Object> event;
          if(n==1)event=Map.of("type","response.completed","response",Map.of("id","invalid","model","gpt-6-astra","output",List.of(Map.of("type","function_call","id","invalid-item","call_id","invalid-call","name","validated_lookup","arguments",rawArguments))));
          else {if(exhausted||n!=2)throw new AssertionError("Work replayed after exhaustion");var body=(Map<String,Object>)request.get("json");var outputs=(List<Map<String,Object>>)body.get("input");if(!"invalid".equals(body.get("previous_response_id"))||outputs.size()!=1||!"invalid-call".equals(outputs.get(0).get("call_id"))||!String.valueOf(outputs.get(0).get("output")).toLowerCase(Locale.ROOT).contains("query"))throw new AssertionError("Invalid correction continuation: "+body);event=completed("corrected","{\"answer\":\"CORRECTED\"}");}
          return "data: "+Json.stringify(event)+"\n\n";
        }
      };
      var client=Ax.ai("openai",Map.of("api_key","test","model","gpt-6-astra","transport",transport));
      var tool=Ax.fn("validated_lookup").description("Requires a query").parameters((Map<String,Object>)Json.parse("{\"type\":\"object\",\"$defs\":{\"query\":{\"type\":\"string\",\"minLength\":3,\"pattern\":\"^[A-Z]+$\"}},\"properties\":{\"query\":{\"$ref\":\"#/$defs/query\"}},\"required\":[\"query\"],\"additionalProperties\":false}")).arg("query",Ax.f().string()).execution("background").handler(args->{calls.incrementAndGet();return "unexpected";}).build();
      var program=Ax.ax("question -> answer").addTool(tool);
      try {var result=program.forward(client,Map.of("question","Find reference"),Map.of("maxSteps",exhausted?1:3));if(exhausted||!"CORRECTED".equals(result.get("answer")))throw new AssertionError("Invalid terminal outcome: "+result);}
      catch(RuntimeException error){if(!exhausted||!error.getMessage().contains("steps"))throw error;}
      if(calls.get()!=0||requests.get()!=(exhausted?1:2))throw new AssertionError("Invalid arguments executed or work replayed");
    }
    System.out.println("java invalid arguments, correction continuation, and step exhaustion passed");
  }
  @SuppressWarnings("unchecked") static void nativeAgent() throws Exception {
    var control=Ax.runControl();control.steer("ROOT-GUIDANCE");control.steer("RESPONDER-ONLY","root/responder");control.setThinkingTokenBudget("medium","root/executor");
    var requests=new AtomicInteger();var calls=new AtomicInteger();var started=new CountDownLatch(1);var release=new CountDownLatch(1);
    OpenAICompatibleClient.Transport transport=new OpenAICompatibleClient.Transport(){
      public Object call(Map<String,Object> request){int number=requests.incrementAndGet();var body=(Map<String,Object>)request.get("json");for(var tool:(List<Map<String,Object>>)body.getOrDefault("tools",List.of()))if(Boolean.TRUE.equals(tool.get("async")))throw new AssertionError("Actor authority leaked to another stage");
        if(number==1)return completed("distiller","{\"completion\":{\"type\":\"final\",\"args\":[\"Find reference\",{}]}}").get("response");
        if(number!=4||!Json.stringify(body).contains("REF-42"))throw new AssertionError("Responder ran before final result incorporation");return completed("responder","{\"answer\":\"REF-42\"}").get("response");
      }
      public Object stream(Map<String,Object> request)throws Exception {int number=requests.incrementAndGet();var body=(Map<String,Object>)request.get("json");
        if(number==1||number==2||number==5||number==6){
          for(var t:(List<Map<String,Object>>)body.getOrDefault("tools",List.of()))if(Boolean.TRUE.equals(t.get("async")))throw new AssertionError("Actor authority leaked");
          String stage=number<3?"distiller":"responder",suffix=(number==1||number==5)?"-start":"-final";
          if(number==2||number==6){String input=Json.stringify(body.get("input"));if(!((stage+"-start").equals(body.get("previous_response_id")))||!input.contains("ROOT-GUIDANCE")||input.contains("RESPONDER-ONLY")!=(number==6))throw new AssertionError("Scoped stage update mismatch: "+body);}
          if(number==5&&!Json.stringify(body).contains("REF-42"))throw new AssertionError("Responder started before incorporation");
          return "data: "+Json.stringify(completed(stage+suffix,number<3?"{\"completion\":{\"type\":\"final\",\"args\":[\"Find reference\",{}]}}":"{\"answer\":\"REF-42\"}"))+"\n\n";
        }
        if(number==3){var tools=(List<Map<String,Object>>)body.get("tools");if(tools.size()!=1||!"tools_lookup".equals(tools.get(0).get("name"))||!Boolean.TRUE.equals(tools.get(0).get("async")))throw new AssertionError("Missing native actor tool");
          var input=new PipedInputStream(8192);var output=new PipedOutputStream(input);Thread worker=new Thread(()->{try(output){emit(output,Map.of("type","response.output_item.done","item",Map.of("type","function_call","id","item","call_id","agent-call","name","tools_lookup","arguments","{\"query\":\"REF-42\"}")));if(!started.await(2,TimeUnit.SECONDS))throw new AssertionError("Agent tool did not overlap model work");release.countDown();emit(output,completed("executor1","{\"completion\":{\"type\":\"final\",\"args\":[\"Report reference\",{\"answer\":\"provisional\"}]}}"));}catch(Exception error){throw new RuntimeException(error);}});worker.setDaemon(true);worker.start();return input;
        }
        if(number!=4||!"executor1".equals(body.get("previous_response_id"))||!Json.stringify(body.get("input")).contains("REF-42"))throw new AssertionError("Lost native result");
        String updates=Json.stringify(body.get("input"));if(!updates.contains("ROOT-GUIDANCE")||updates.contains("RESPONDER-ONLY")||!updates.contains("configuration_update")||!updates.contains("medium"))throw new AssertionError("Missing executor update");
        return "data: "+Json.stringify(completed("executor2","{\"completion\":{\"type\":\"final\",\"args\":[\"Report reference\",{\"answer\":\"REF-42\"}]}}"))+"\n\n";
      }
    };
    var tool=Ax.fn("lookup").description("Lookup").arg("query",Ax.f().string()).execution("background").handler(args->{calls.incrementAndGet();started.countDown();if(!release.await(2,TimeUnit.SECONDS))throw new AssertionError("Model did not overlap the handler");return args.get("query");}).build();
    var program=Ax.agent("question -> answer",Map.of("functions",List.of(tool),"directResponse","off"));var client=Ax.ai("openai",Map.of("api_key","test","model","gpt-6-astra","transport",transport));
    var result=program.forward(client,Map.of("question","Find reference"),Map.of("control",control));if(!"REF-42".equals(result.get("answer"))||calls.get()!=1||requests.get()!=6)throw new AssertionError("Invalid native agent result");
    var activity=program.getActionLog().stream().map(entry->(Map<String,Object>)entry).filter(entry->"function_call".equals(entry.get("type"))).toList();
    if(activity.size()!=1||!"tools.lookup".equals(activity.get(0).get("qualified_name"))||!"agent-call".equals(activity.get(0).get("call_id")))throw new AssertionError("Lost native activity: "+activity);
    var duplicate=(Map<String,Object>)program.invokeCallable("tools.lookup",Map.of("query","REF-42"));if(!"error".equals(duplicate.get("status"))||calls.get()!=1)throw new AssertionError("Native call replayed through actor machinery");
    System.out.println("java native agent tools, authority boundaries, action logs, and duplicate prevention passed");
  }
  static void noncooperativeCancellation() throws Exception {
    var controller=Ax.runControl();var events=new CopyOnWriteArrayList<Map<String,Object>>();controller.onEvent(events::add);
    var incoming=new LinkedBlockingQueue<Map<String,Object>>();var closed=new java.util.concurrent.atomic.AtomicBoolean();var settled=new CountDownLatch(1);var sends=new AtomicInteger();
    OpenAICompatibleClient.RealtimeTransport socket=new OpenAICompatibleClient.RealtimeTransport(){
      public void send(Map<String,Object> event){if(sends.incrementAndGet()!=1)throw new AssertionError("Cancelled work replayed");incoming.add(Map.of("type","response.created","response",Map.of("id","pending")));incoming.add(Map.of("type","response.output_item.done","item",Map.of("type","function_call","id","item","call_id","pending-call","name","lookup","arguments","{}")));}
      public Map<String,Object> recv(){try{return incoming.take();}catch(InterruptedException error){Thread.currentThread().interrupt();return null;}}
      public void close(){closed.set(true);incoming.offer(Map.of());}
    };
    var release=new CountDownLatch(1);
    var tool=Ax.fn("lookup").description("Lookup").execution("background").contextHandler((args,cancelled)->{controller.abort();long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(3);boolean done=false;while(!done && System.nanoTime()<deadline){try{done=release.await(20,TimeUnit.MILLISECONDS);}catch(InterruptedException ignored){}}if(!done)throw new AssertionError("Caller waited for noncooperative work");settled.countDown();return "LATE";}).build();
    var client=Ax.ai("openai",Map.of("api_key","test","model","gpt-6-astra","webSocketTransport",socket));
    var pendingProgram=Ax.ax("question -> answer").addTool(tool);long start=System.nanoTime();try{pendingProgram.forward(client,Map.of("question","Find answer"),Map.of("control",controller));throw new AssertionError("Cancelled run returned success");}catch(Exception error){if(!error.toString().contains("pending-call"))throw error;}
    var unresolved=pendingProgram.getFunctionCallTraces();if(unresolved.size()!=1||!"pending-call".equals(unresolved.get(0).get("id"))||!"unresolved".equals(unresolved.get(0).get("status")))throw new AssertionError("Unresolved action missing: "+unresolved);
    if(settled.getCount()!=1||!closed.get())throw new AssertionError("Caller waited for tool completion");release.countDown();
    if(System.nanoTime()-start>TimeUnit.SECONDS.toNanos(2)||!closed.get()||!settled.await(2,TimeUnit.SECONDS)||sends.get()!=1)throw new AssertionError("Cancellation leaked or replayed work");
    if(!List.of("pending-call").equals(events.get(events.size()-1).get("pending_call_ids")))throw new AssertionError("Lost unresolved IDs");
    var validated=Ax.fn("validated").description("Validation").returnsField("value",Ax.f().number()).contextHandler((args,cancelled)->Map.of("value","bad")).build();
    try{validated.call(Map.of());throw new AssertionError("Context handler bypassed return validation");}catch(IllegalArgumentException expected){}
    System.out.println("java noncooperative cancellation returns before tool completion");
  }

  static void cancellation() throws Exception {
    var controller=Ax.runControl();var events=new CopyOnWriteArrayList<Map<String,Object>>();controller.onEvent(events::add);
    var incoming=new LinkedBlockingQueue<Map<String,Object>>();var closed=new java.util.concurrent.atomic.AtomicBoolean();var settled=new CountDownLatch(1);var sends=new AtomicInteger();
    OpenAICompatibleClient.RealtimeTransport socket=new OpenAICompatibleClient.RealtimeTransport(){
      public void send(Map<String,Object> event){if(sends.incrementAndGet()!=1)throw new AssertionError("Cancelled work replayed");incoming.add(Map.of("type","response.created","response",Map.of("id","pending")));incoming.add(Map.of("type","response.output_item.done","item",Map.of("type","function_call","id","item","call_id","pending-call","name","lookup","arguments","{}")));}
      public Map<String,Object> recv(){try{return incoming.take();}catch(InterruptedException error){Thread.currentThread().interrupt();return null;}}
      public void close(){closed.set(true);incoming.offer(Map.of());}
    };
    var tool=Ax.fn("lookup").description("Lookup").execution("background").contextHandler((args,cancelled)->{controller.abort();long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(2);while(!cancelled.getAsBoolean() && System.nanoTime()<deadline)Thread.onSpinWait();if(!cancelled.getAsBoolean())throw new AssertionError("Tool missed cancellation");settled.countDown();return "LATE";}).build();
    var client=Ax.ai("openai",Map.of("api_key","test","model","gpt-6-astra","webSocketTransport",socket));
    long start=System.nanoTime();try{Ax.ax("question -> answer").addTool(tool).forward(client,Map.of("question","Find answer"),Map.of("control",controller));throw new AssertionError("Cancelled run returned success");}catch(Exception error){if(!error.toString().contains("pending-call"))throw error;}
    if(System.nanoTime()-start>TimeUnit.SECONDS.toNanos(2)||!closed.get()||!settled.await(2,TimeUnit.SECONDS)||sends.get()!=1)throw new AssertionError("Cancellation leaked or replayed work");
    if(!List.of("pending-call").equals(events.get(events.size()-1).get("pending_call_ids")))throw new AssertionError("Lost unresolved IDs");
    var validated=Ax.fn("validated").description("Validation").returnsField("value",Ax.f().number()).contextHandler((args,cancelled)->Map.of("value","bad")).build();
    try{validated.call(Map.of());throw new AssertionError("Context handler bypassed return validation");}catch(IllegalArgumentException expected){}
    System.out.println("java cancellation context, pending IDs, and late-result isolation passed");
  }
  static void nativeSteering() throws Exception {
    class Socket implements OpenAICompatibleClient.RealtimeTransport {
      final BlockingQueue<Map<String,Object>> incoming=new LinkedBlockingQueue<>();
      final List<Map<String,Object>> sent=new ArrayList<>();boolean closed;
      public void send(Map<String,Object> event) {
        sent.add(event);
        if("response.create".equals(event.get("type"))) {
          if(event.containsKey("stream"))throw new AssertionError("WebSocket create retained stream");
          incoming.add(Map.of("type","response.created","response",Map.of("id","parent")));
          incoming.add(Map.of("type","response.output_text.delta","delta","provisional"));
        } else {
          if(!"response.steer".equals(event.get("type")) || !"parent".equals(event.get("previous_response_id")))throw new AssertionError("Invalid steer");
          var ack=Map.<String,Object>of("type","response.steer.accepted","steer",Map.of("id","s1","previous_response_id","parent"));
          incoming.add(ack);incoming.add(ack);
          incoming.add(Map.of("type","response.incomplete","response",Map.of("id","parent","model","gpt-6-astra","output",List.of(),"incomplete_details",Map.of("reason","steered"),"usage",Map.of("input_tokens",3,"output_tokens",2))));
          incoming.add(Map.of("type","response.created","response",Map.of("id","successor")));
          incoming.add(completed("successor","{\"answer\":\"CORRECTED\"}"));
        }
      }
      public Map<String,Object> recv(){try{var event=incoming.poll(5,TimeUnit.SECONDS);return event==null || event.isEmpty()?null:event;}catch(InterruptedException error){Thread.currentThread().interrupt();return null;}}
      public void close(){closed=true;incoming.offer(Map.of());}
    }
    var socket=new Socket();var controller=Ax.runControl();var applied=new ArrayList<Object>();var steered=new java.util.concurrent.atomic.AtomicBoolean();
    controller.onEvent(event->{if("model.output".equals(event.get("type")) && steered.compareAndSet(false,true))controller.steer("Use CORRECTED.");if("applied".equals(event.get("type")))applied.add(event.get("timing"));});
    OpenAICompatibleClient.SessionWebSocketFactory factory=(url,headers)->{if(!"wss://example.test/v1/responses".equals(url) || !"Bearer test".equals(headers.get("Authorization")))throw new AssertionError("Lost endpoint or authentication");return socket;};
    var client=Ax.ai("openai",Map.of("api_key","test","model","gpt-6-astra","base_url","https://example.test/v1","webSocketFactory",factory));
    var program=Ax.ax("question -> answer");var result=program.forward(client,Map.of("question","Find answer"),Map.of("control",controller));
    if(!"CORRECTED".equals(result.get("answer")) || !applied.equals(List.of("native")) || socket.sent.size()!=2 || !socket.closed)throw new AssertionError("Native steering replay or incorrect completion: "+result+applied);
    var ids=program.getChatLog().stream().map(entry->entry.get("remote_id")).toList();
    if(!ids.equals(List.of("parent","successor")))throw new AssertionError("Lost response accounting: "+ids);
    System.out.println("java native steering, successor accounting, and closure passed");
  }
  @SuppressWarnings("unchecked") static void flowIsolation() throws Exception {
    AtomicInteger requests=new AtomicInteger(),calls=new AtomicInteger();
    List<String> applied=new ArrayList<>();AxRunControl control=Ax.runControl();
    control.onEvent(event->{if("applied".equals(event.get("type")))applied.add(String.valueOf(event.get("path")));});
    control.steer("Keep the reference exact.");
    OpenAICompatibleClient.Transport transport=new OpenAICompatibleClient.Transport(){
      public Object call(Map<String,Object> request){throw new AssertionError("Expected streaming");}
      public Object stream(Map<String,Object> request){
        var body=(Map<String,Object>)request.get("json");Object event;
        if(!"gpt-6-astra".equals(body.get("model")))throw new AssertionError("Alias was not resolved");
        if(requests.incrementAndGet()%2==1){
          if(body.containsKey("previous_response_id"))throw new AssertionError("Node inherited another conversation");
          event=Map.of("type","response.completed","response",Map.of("id","node-start","model","gpt-6-astra","output",List.of(Map.of("type","function_call","id","item","call_id","same-call","name","lookup","arguments","{\"query\":\"REF-42\"}"))));
        }else{
          if(!"node-start".equals(body.get("previous_response_id")))throw new AssertionError("Lost node response ID");
          var input=(List<Map<String,Object>>)body.get("input");
          if(input.size()!=2 || !"user".equals(input.get(0).get("role")) || !Map.of("type","function_call_output","call_id","same-call","output","REF-42").equals(input.get(1)))throw new AssertionError("Lost scoped update or result: "+input);
          event=completed("node-final","{\"answer\":\"REF-42\"}");
        }
        final Object completedEvent=event;
        return (Iterable<Object>)()->new Iterator<>() {
          boolean delivered;
          public boolean hasNext(){if(delivered)throw new IllegalStateException("HTTP reader continued after response completion");return true;}
          public Object next(){delivered=true;return completedEvent;}
        };
      }
    };
    var underlying=Ax.ai("openai",Map.of("api_key","test","model","gpt-6-astra","transport",transport));
    var client=AxMultiServiceRouter.create(List.of(Map.of("key","smart","service",underlying)));
    if(!Boolean.TRUE.equals(client.getFeatures("smart").get("asyncTools")))throw new AssertionError("Alias capabilities");
    var tool=Ax.fn("lookup").description("Look up reference").arg("query",Ax.f().string()).execution("background").handler(values->{calls.incrementAndGet();return values.get("query");}).build();
    var workflow=Ax.flow().execute("first",Ax.ax("question -> answer").addTool(tool)).execute("second",Ax.ax("question -> answer").addTool(tool)).returns(Map.of("first","firstResult","second","secondResult"));
    for(int index=0;index<2;index++){
      var output=workflow.forward(client,Map.of("question","Find reference"),Map.of("control",control,"model","smart"));
      if(!output.equals(Map.of("first",Map.of("answer","REF-42"),"second",Map.of("answer","REF-42"))))throw new AssertionError(output);
    }
    if(requests.get()!=8 || calls.get()!=4 || !applied.equals(List.of("root/first","root/second","root/first","root/second")))throw new AssertionError("Flow isolation: "+applied);
    control.onEvent(event->{if("completed".equals(event.get("type")) && "root/first".equals(event.get("path")))control.abort();});
    try {workflow.forward(client,Map.of("question","Find reference"),Map.of("control",control,"model","smart"));throw new AssertionError("Aborted flow returned success");}
    catch(RuntimeException error){if(!error.getMessage().contains("Flow aborted"))throw error;}
    if(requests.get()!=10 || calls.get()!=5)throw new AssertionError("Aborted flow started another node");
    System.out.println("java flow conversations, future root updates, and controlled reruns passed");
  }

  static void stalledHttpCancellation() throws Exception {
    try(var listener=new java.net.ServerSocket(0,1,java.net.InetAddress.getLoopbackAddress())) {
      var closed=new CompletableFuture<Boolean>();
      Thread server=new Thread(()->{try(var socket=listener.accept()) {
        socket.setSoTimeout(3000);var input=socket.getInputStream();var header=new java.io.ByteArrayOutputStream();int value;
        while(!(header.toString(java.nio.charset.StandardCharsets.US_ASCII).endsWith("\r\n\r\n"))) {value=input.read();if(value<0)throw new AssertionError("Missing HTTP request");header.write(value);}
        int length=0;for(String line:header.toString(java.nio.charset.StandardCharsets.US_ASCII).split("\r\n"))if(line.toLowerCase(java.util.Locale.ROOT).startsWith("content-length:"))length=Integer.parseInt(line.substring(line.indexOf(':')+1).trim());
        if(input.readNBytes(length).length!=length)throw new AssertionError("Incomplete request body");
        var output=socket.getOutputStream();output.write("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n".getBytes(java.nio.charset.StandardCharsets.US_ASCII));
        byte[] event=("data: "+Json.stringify(Map.of("type","response.output_item.done","item",Map.of("type","function_call","id","item","call_id","http-pending","name","lookup","arguments","{}")))+"\n\n").getBytes(java.nio.charset.StandardCharsets.UTF_8);
        output.write((Integer.toHexString(event.length)+"\r\n").getBytes(java.nio.charset.StandardCharsets.US_ASCII));output.write(event);output.write("\r\n".getBytes(java.nio.charset.StandardCharsets.US_ASCII));output.flush();
        try{closed.complete(input.read()==-1);}catch(java.net.SocketException reset){closed.complete(true);}
      }catch(Throwable error){closed.completeExceptionally(error);}},"ax-stalled-http");server.setDaemon(true);server.start();
      var control=Ax.runControl();var lookup=Ax.fn("lookup").description("Lookup").execution("background").contextHandler((args,cancelled)->{control.abort();return "LATE";}).build();
      var program=Ax.ax("question -> answer").addTool(lookup);var client=Ax.ai("openai",Map.of("api_key","test","model","gpt-6-astra","base_url","http://localhost:"+listener.getLocalPort()));
      try{program.forward(client,Map.of("question","Lookup"),Map.of("control",control));throw new AssertionError("Cancelled run returned success");}catch(CancellationException error){if(!error.getMessage().contains("http-pending"))throw error;}
      if(!closed.get(3,TimeUnit.SECONDS))throw new AssertionError("HTTP worker retained its connection");server.join(3000);
    }
    System.out.println("java cancellation closes a stalled native HTTP connection");
  }

  static void mixedBalancer() throws Exception {
    var tools=new AtomicInteger();
    class ChatOnly extends OpenAICompatibleClient {
      final boolean unused;int calls;
      ChatOnly(boolean unused){super(Map.of("api_key","test","model","gpt-6-astra"));this.unused=unused;}
      public Map<String,Object> getFeatures(String model){var features=new LinkedHashMap<>(super.getFeatures(model));features.put("asyncTools",unused);return features;}
      public Map<String,Object> chat(Map<String,Object> request,Map<String,Object> options){
        if(unused)throw new AssertionError("Pinned run changed providers");calls++;
        if(calls==1)return Map.of("results",List.of(Map.of("function_calls",List.of(Map.of("id","balanced-call","function",Map.of("name","lookup","params",Map.of()))))));
        if(calls!=2||tools.get()!=1||!request.toString().contains("FALLBACK")||!request.toString().contains("balanced-call"))throw new AssertionError("Lost tool continuation: "+request);
        return Map.of("results",List.of(Map.of("content","{\"answer\":\"FALLBACK\"}")));
      }
      public AxChatSession openChatSession(Map<String,Object> request,Map<String,Object> options){throw new AssertionError("Chat-only selection opened a session");}
    }
    var ordinary=new ChatOnly(false);var unused=new ChatOnly(true);var client=new AxBalancer(List.of(ordinary,unused),Map.of("strategy","input_order"));
    var program=Ax.ax("question -> answer").addTool(Ax.fn("lookup").description("Lookup").execution("background").handler(args->{tools.incrementAndGet();return "FALLBACK";}).build());
    var result=program.forward(client,Map.of("question","Lookup"));
    if(!"FALLBACK".equals(result.get("answer"))||ordinary.calls!=2||unused.calls!=0||tools.get()!=1)throw new AssertionError("Invalid pinned result: "+result);
    System.out.println("java mixed balancer pins ordinary-chat fallback for the entire run");
  }

  static class BoundarySocket implements OpenAICompatibleClient.RealtimeTransport {
    final BlockingQueue<Map<String,Object>> inbound=new LinkedBlockingQueue<>();
    final CountDownLatch terminalReceived=new CountDownLatch(1);
    final List<String> sent=new CopyOnWriteArrayList<>();
    int received;
    public void send(Map<String,Object> event) {
      String type=(String)event.get("type");sent.add(type);
      if(type.equals("response.create")){
        inbound.add(Map.of("type","response.created","response",Map.of("id","parent")));
        inbound.add(Map.of("type","response.output_text.delta","delta","provisional"));
        inbound.add(Map.of("type","response.completed","response",Map.of("id","parent","model","gpt-6-astra","output",List.of())));
      }
    }
    public Map<String,Object> recv(){try{if(received==3)terminalReceived.countDown();var event=inbound.take();received++;return event;}catch(InterruptedException e){Thread.currentThread().interrupt();return null;}}
    public void close(){inbound.offer(Map.of());}
  }
  static void bufferedSteeringBoundary()throws Exception{
    BoundarySocket socket=new BoundarySocket();
    var client=Ax.ai("openai",Map.of("api_key","test","model","gpt-6-astra","webSocketTransport",socket));
    try(var session=((AxChatSession.Provider)client).openChatSession(Map.of("chat_prompt",List.of(Map.of("role","user","content","probe"))),Map.of())){
      if(!socket.terminalReceived.await(2,TimeUnit.SECONDS))throw new AssertionError("Reader failed to receive terminal event");
      var event=session.next();
      if(!"response".equals(event.get("type")))throw new AssertionError(event);
      String timing=session.update(Map.of("type","steer","text","Use corrected answer"));
      System.out.println("terminal already received; update timing="+timing+"; sent="+socket.sent);
      if(!"next-response".equals(timing) || !socket.sent.equals(List.of("response.create")))throw new AssertionError("Steered a completed response");
    }
  }
 public static void mcpContextCancellation()throws Exception{
  try(var listener=new ServerSocket(0,1,InetAddress.getLoopbackAddress())){
   var started=new CountDownLatch(1);var closed=new CountDownLatch(1);var errors=new AtomicReference<Throwable>();var requests=new AtomicInteger();
   Thread server=new Thread(()->{try(var socket=listener.accept()){
    socket.setSoTimeout(3000);var reader=new BufferedReader(new InputStreamReader(socket.getInputStream()));int length=0;String line;boolean header=false;
    while((line=reader.readLine())!=null&&!line.isEmpty()){if(line.toLowerCase().startsWith("content-length:"))length=Integer.parseInt(line.substring(line.indexOf(':')+1).trim());if(line.equalsIgnoreCase("X-Tenant: fixture"))header=true;}
    char[] body=new char[length];int offset=0;while(offset<length){int n=reader.read(body,offset,length-offset);if(n<0)throw new EOFException();offset+=n;}
    if(!header||!new String(body).contains("probe"))throw new AssertionError("request data changed");requests.incrementAndGet();socket.getOutputStream().write("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n".getBytes());socket.getOutputStream().flush();started.countDown();if(reader.read()==-1)closed.countDown();
   }catch(Throwable e){errors.set(e);started.countDown();}});server.setDaemon(true);server.start();
   var http=new AxMCPStreamableHTTPTransport("http://127.0.0.1:"+listener.getLocalPort(),Map.of("ssrfProtection",Map.of("requireHttps",false,"allowLocalhost",true,"allowPrivateNetworks",true),"headers",Map.of("X-Tenant","fixture")));
   AxMCPTransport transport=new AxMCPTransport(){public void sendNotification(Map<String,Object> m){}public Map<String,Object> send(Map<String,Object> m){String method=(String)m.get("method");Object result=method.equals("initialize")?Map.of("protocolVersion","2025-11-25","capabilities",Map.of("tools",Map.of()),"serverInfo",Map.of("name","fixture","version","1")):Map.of("tools",List.of(Map.of("name","lookup","inputSchema",Map.of("type","object"))));return Map.of("jsonrpc","2.0","id",m.get("id"),"result",result);}public Map<String,Object> sendWithContext(Map<String,Object> m,Map<String,String> h,java.util.function.BooleanSupplier c){return m.get("method").equals("tools/call")?http.sendWithContext(m,h,c):AxMCPTransport.super.sendWithContext(m,h,c);}};
   var client=new AxMCPClient(transport,Map.of("namespace","inventory","era","legacy"));client.init();var tool=client.nativeTools().get(0);var cancelled=new AtomicBoolean();var failure=new AtomicReference<Throwable>();
   Thread worker=new Thread(()->{try{tool.call(Map.of("query","probe"),cancelled::get);}catch(Throwable e){failure.set(e);}});worker.setDaemon(true);worker.start();if(!started.await(2,TimeUnit.SECONDS))throw new AssertionError("request did not start");if(errors.get()!=null)throw new AssertionError(errors.get());cancelled.set(true);worker.join(1000);if(worker.isAlive()||!(failure.get() instanceof AxAIServiceAbortedError))throw new AssertionError(failure.get());if(!closed.await(1,TimeUnit.SECONDS))throw new AssertionError("connection not closed");
   try{tool.call(Map.of(),cancelled::get);throw new AssertionError("cancelled tool ran");}catch(AxAIServiceAbortedError expected){}if(requests.get()!=1)throw new AssertionError("request replayed");server.join();System.out.println("Java MCP native cancellation and HTTP cleanup passed");
  }
 }

  static void nativeAgentMCPCancellation() throws Exception {
    var control=Ax.runControl();var calls=new AtomicInteger();var requests=new AtomicInteger();var settled=new CountDownLatch(1);
    AxMCPTransport mcpTransport=new AxMCPTransport(){
      public void sendNotification(Map<String,Object> message){}
      public Map<String,Object> send(Map<String,Object> message){
        var result="initialize".equals(message.get("method"))?Map.of("protocolVersion","2025-11-25","serverInfo",Map.of("name","fixture","version","1"),"capabilities",Map.of("tools",Map.of())):Map.of("tools",List.of(Map.of("name","lookup","inputSchema",Map.of("type","object"))));
        return Map.of("jsonrpc","2.0","id",message.get("id"),"result",result);
      }
      public Map<String,Object> sendWithContext(Map<String,Object> message,Map<String,String> headers,java.util.function.BooleanSupplier cancelled){
        if(!"tools/call".equals(message.get("method")))return AxMCPTransport.super.sendWithContext(message,headers,cancelled);
        calls.incrementAndGet();control.abort();long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(2);
        while(!cancelled.getAsBoolean()&&System.nanoTime()<deadline)Thread.onSpinWait();
        if(!cancelled.getAsBoolean())throw new AssertionError("Agent did not cancel imported MCP tool");
        settled.countDown();throw new AxAIServiceAbortedError("MCP invocation cancelled");
      }
    };
    var mcp=new AxMCPClient(mcpTransport,Map.of("era","legacy","namespace","inventory"));mcp.init();var imported=mcp.nativeTools().get(0);var nativeTool=Ax.fn(imported.name).description("Lookup").parameters(imported.schema()).execution("background").contextHandler(imported::call).build();
    OpenAICompatibleClient.Transport model=new OpenAICompatibleClient.Transport(){
      public Object call(Map<String,Object> request){throw new AssertionError("Expected streaming");}
      public Object stream(Map<String,Object> request){
        int number=requests.incrementAndGet();
        if(number==1)return "data: "+Json.stringify(completed("distiller","{\"completion\":{\"type\":\"final\",\"args\":[\"Find reference\",{}]}}"))+"\n\n";
        if(number!=2)throw new AssertionError("Cancelled agent continued");
        return "data: "+Json.stringify(Map.of("type","response.output_item.done","item",Map.of("type","function_call","id","item","call_id","mcp-pending","name","tools_lookup","arguments","{}")))+"\n\n"+"data: "+Json.stringify(completed("actor","{\"completion\":{\"type\":\"final\",\"args\":[\"provisional\",{}]}}"))+"\n\n";
      }
    };
    var program=Ax.agent("question -> answer",Map.of("functions",List.of(nativeTool),"functionDiscovery",false,"directResponse","off"));
    var client=Ax.ai("openai",Map.of("api_key","test","model","gpt-6-astra","transport",model));
    try{program.forward(client,Map.of("question","Find reference"),Map.of("control",control));throw new AssertionError("Cancelled agent succeeded");}
    catch(RuntimeException error){if(!error.toString().toLowerCase().contains("abort"))throw error;}
    if(calls.get()!=1||requests.get()!=2||!settled.await(2,TimeUnit.SECONDS))throw new AssertionError("MCP work leaked or replayed");
  }
}
