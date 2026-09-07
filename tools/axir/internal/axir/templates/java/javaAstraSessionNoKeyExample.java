import dev.axllm.ax.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

public final class AstraSessionTest {
  private static void emit(OutputStream output,Object event) throws IOException { output.write(("data: "+Json.stringify(event)+"\n\n").getBytes(StandardCharsets.UTF_8));output.flush(); }
  private static Map<String,Object> completed(String id,String answer) {return Map.of("type","response.completed","response",Map.of("id",id,"model","gpt-6-astra","output",List.of(Map.of("type","message","id","msg-"+id,"content",List.of(Map.of("type","output_text","text",answer))))));}
  public static void main(String[] args) throws Exception {
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
  }
  @SuppressWarnings("unchecked") static void invalidArgumentsAndExhaustion() {
    for(boolean exhausted:List.of(false,true)) {
      var requests=new AtomicInteger();var calls=new AtomicInteger();
      OpenAICompatibleClient.Transport transport=new OpenAICompatibleClient.Transport(){
        public Object call(Map<String,Object> request){throw new AssertionError("Expected streaming");}
        public Object stream(Map<String,Object> request){int n=requests.incrementAndGet();Map<String,Object> event;
          if(n==1)event=Map.of("type","response.completed","response",Map.of("id","invalid","model","gpt-6-astra","output",List.of(Map.of("type","function_call","id","invalid-item","call_id","invalid-call","name","validated_lookup","arguments","{}"))));
          else {if(exhausted||n!=2)throw new AssertionError("Work replayed after exhaustion");var body=(Map<String,Object>)request.get("json");var outputs=(List<Map<String,Object>>)body.get("input");if(!"invalid".equals(body.get("previous_response_id"))||outputs.size()!=1||!"invalid-call".equals(outputs.get(0).get("call_id"))||!String.valueOf(outputs.get(0).get("output")).toLowerCase(Locale.ROOT).contains("query"))throw new AssertionError("Invalid correction continuation: "+body);event=completed("corrected","{\"answer\":\"CORRECTED\"}");}
          return "data: "+Json.stringify(event)+"\n\n";
        }
      };
      var client=Ax.ai("openai",Map.of("api_key","test","model","gpt-6-astra","transport",transport));
      var tool=Ax.fn("validated_lookup").description("Requires a query").arg("query",Ax.f().string()).execution("background").handler(args->{calls.incrementAndGet();return "unexpected";}).build();
      var program=Ax.ax("question -> answer").addTool(tool);
      try {var result=program.forward(client,Map.of("question","Find reference"),Map.of("maxSteps",exhausted?1:3));if(exhausted||!"CORRECTED".equals(result.get("answer")))throw new AssertionError("Invalid terminal outcome: "+result);}
      catch(RuntimeException error){if(!exhausted||!error.getMessage().contains("steps"))throw error;}
      if(calls.get()!=0||requests.get()!=(exhausted?1:2))throw new AssertionError("Invalid arguments executed or work replayed");
    }
    System.out.println("java invalid arguments, correction continuation, and step exhaustion passed");
  }
  @SuppressWarnings("unchecked") static void nativeAgent() throws Exception {
    var requests=new AtomicInteger();var calls=new AtomicInteger();var started=new CountDownLatch(1);var release=new CountDownLatch(1);
    OpenAICompatibleClient.Transport transport=new OpenAICompatibleClient.Transport(){
      public Object call(Map<String,Object> request){int number=requests.incrementAndGet();var body=(Map<String,Object>)request.get("json");for(var tool:(List<Map<String,Object>>)body.getOrDefault("tools",List.of()))if(Boolean.TRUE.equals(tool.get("async")))throw new AssertionError("Actor authority leaked to another stage");
        if(number==1)return completed("distiller","{\"completion\":{\"type\":\"final\",\"args\":[\"Find reference\",{}]}}").get("response");
        if(number!=4||!Json.stringify(body).contains("REF-42"))throw new AssertionError("Responder ran before final result incorporation");return completed("responder","{\"answer\":\"REF-42\"}").get("response");
      }
      public Object stream(Map<String,Object> request)throws Exception {int number=requests.incrementAndGet();var body=(Map<String,Object>)request.get("json");
        if(number==2){var tools=(List<Map<String,Object>>)body.get("tools");if(tools.size()!=1||!"tools_lookup".equals(tools.get(0).get("name"))||!Boolean.TRUE.equals(tools.get(0).get("async")))throw new AssertionError("Missing native actor tool");
          var input=new PipedInputStream(8192);var output=new PipedOutputStream(input);Thread worker=new Thread(()->{try(output){emit(output,Map.of("type","response.output_item.done","item",Map.of("type","function_call","id","item","call_id","agent-call","name","tools_lookup","arguments","{\"query\":\"REF-42\"}")));if(!started.await(2,TimeUnit.SECONDS))throw new AssertionError("Agent tool did not overlap model work");release.countDown();emit(output,completed("executor1","{\"completion\":{\"type\":\"final\",\"args\":[\"Report reference\",{\"answer\":\"provisional\"}]}}"));}catch(Exception error){throw new RuntimeException(error);}});worker.setDaemon(true);worker.start();return input;
        }
        if(number!=3||!"executor1".equals(body.get("previous_response_id"))||!Json.stringify(body.get("input")).contains("REF-42"))throw new AssertionError("Lost native result");
        return "data: "+Json.stringify(completed("executor2","{\"completion\":{\"type\":\"final\",\"args\":[\"Report reference\",{\"answer\":\"REF-42\"}]}}"))+"\n\n";
      }
    };
    var tool=Ax.fn("lookup").description("Lookup").arg("query",Ax.f().string()).execution("background").handler(args->{calls.incrementAndGet();started.countDown();if(!release.await(2,TimeUnit.SECONDS))throw new AssertionError("Model did not overlap the handler");return args.get("query");}).build();
    var program=Ax.agent("question -> answer",Map.of("functions",List.of(tool),"directResponse","off"));var client=Ax.ai("openai",Map.of("api_key","test","model","gpt-6-astra","transport",transport));
    var result=program.forward(client,Map.of("question","Find reference"));if(!"REF-42".equals(result.get("answer"))||calls.get()!=1||requests.get()!=4)throw new AssertionError("Invalid native agent result");
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
    long start=System.nanoTime();try{Ax.ax("question -> answer").addTool(tool).forward(client,Map.of("question","Find answer"),Map.of("control",controller));throw new AssertionError("Cancelled run returned success");}catch(Exception error){if(!error.toString().contains("pending-call"))throw error;}
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
}
