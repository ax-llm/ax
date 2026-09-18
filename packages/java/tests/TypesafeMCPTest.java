import dev.axllm.ax.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

public final class TypesafeMCPTest {
  static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
  static final class Socket implements AxMCPWebSocketTransport.Socket {
    final BlockingQueue<String> inbound=new LinkedBlockingQueue<>(),sent=new LinkedBlockingQueue<>();
    volatile boolean fail;
    public void send(String text){if(fail)throw new IllegalStateException("send failed");sent.add(text);}
    public String receive()throws Exception{String text=inbound.take();return "CLOSE".equals(text)?null:text;}
    public void close(){inbound.add("CLOSE");}
    void sent()throws Exception{check(sent.poll(2,TimeUnit.SECONDS)!=null,"request did not start");}
    void respond(String value){inbound.add("{\"id\":1,\"result\":\""+value+"\"}");}
  }
  static void error(Future<?> task,String message)throws Exception{
    try{task.get(2,TimeUnit.SECONDS);throw new AssertionError("expected "+message);}catch(ExecutionException e){check(e.getCause().toString().contains(message),e.toString());}
  }
  static void websocket()throws Exception{
    Socket socket=new Socket();var transport=new AxMCPWebSocketTransport("ws://example.test",List.of(),(url,protocols)->socket);transport.setProtocolVersion("2025-03-26");
    var pool=Executors.newFixedThreadPool(3);Map<String,Object> request=Map.of("id",1,"method","ping");var batch=List.of(request,Map.<String,Object>of("id",2,"method","ping"));
    try{
      socket.fail=true;error(pool.submit(()->transport.send(request)),"send failed");error(pool.submit(()->transport.sendBatch(batch)),"send failed");socket.fail=false;
      var old=new AtomicBoolean();var first=pool.submit(()->transport.sendWithContext(request,Map.of(),old::get));socket.sent();socket.respond("first");check(first.get(2,TimeUnit.SECONDS).get("result").equals("first"),"first response");
      var second=pool.submit(()->transport.send(request));socket.sent();old.set(true);
      error(pool.submit(()->transport.send(request)),"already pending");socket.respond("second");check(second.get(2,TimeUnit.SECONDS).get("result").equals("second"),"old cancellation removed reused ID");
      var abort=new AtomicBoolean();var cancelled=pool.submit(()->transport.sendBatch(batch,abort::get));socket.sent();abort.set(true);error(cancelled,"cancelled");
      var closed=pool.submit(()->transport.sendBatch(batch));socket.sent();transport.close();error(closed,"closed");
    }finally{transport.close();pool.shutdownNow();check(pool.awaitTermination(2,TimeUnit.SECONDS),"request workers leaked");}
  }
  @SuppressWarnings("unchecked") static void nativeClient()throws Exception{
    var discovery=new AtomicInteger();var credentials=new AtomicInteger();
    OpenAICompatibleClient.Transport transport=request->{
      if(request.get("method").equals("GET")){
        check(!request.containsKey("json")&&!request.containsKey("data"),"GET has body");
        if(discovery.incrementAndGet()==1)return Map.of("status",429,"json",Map.of("error","retry"));
        return Map.of("models",List.of(Map.of("name","jev-latest","description","Jev","release_date","2026-09-01")));
      }
      var payload=(Map<String,Object>)request.get("json");var answers=new LinkedHashMap<String,Object>();
      for(String key:((Map<String,Object>)payload.get("questions")).keySet())answers.put(key,Map.of("type","noul","noul",((Map<String,Object>)payload.get("state")).get("probability")));
      return Map.of("model",payload.get("model"),"answers",answers,"usage",Map.of("input_tokens",1,"output_tokens",1));
    };
    OpenAICompatibleClient.CredentialProvider credential=request->{credentials.incrementAndGet();return Map.of("Authorization","Bearer test");};
    var client=Ax.typesafe(Map.of("credential_provider",credential,"transport",transport,"retry",Map.of("maxRetries",1,"initialDelayMs",1)));
    check(client.listModels().get(0).name().equals("jev-latest")&&discovery.get()==2&&credentials.get()==2,"model discovery and retry");
    var pool=Executors.newFixedThreadPool(4);
    try{
      List<Future<?>> tasks=new ArrayList<>();
      for(int i=0;i<10;i++){final int index=i;tasks.add(pool.submit(()->{String key="question"+index;double probability=index/10.0;try{
        var response=client.systemOne(Map.of("state",Map.of("probability",probability),"questions",Map.of(key,Map.of("type","noul"))));
        var answers=response.answers();check(((AxAITypesafeClient.Noul)answers.get(key)).noul()==probability,"native probability or question key changed");
      }catch(Exception error){throw new RuntimeException(error);}}));}
      for(var task:tasks)task.get(2,TimeUnit.SECONDS);
      AxCancellationToken token=new AxCancellationToken();token.cancel("cancel native");
      int before=credentials.get();try{client.systemOne(Map.of("state",Map.of("probability",0.5),"questions",Map.of("flag",Map.of("type","noul"))),Map.of("cancellation",token));throw new AssertionError("pre-aborted request accepted");}catch(AxAIServiceAbortedError expected){}
      check(credentials.get()==before,"aborted request accessed credentials");
    }finally{pool.shutdownNow();}
  }
  @SuppressWarnings("unchecked") static void nestedValidation() {
    var typed=Ax.ai("typesafe",Map.of("api_key","test","models",List.of()));
    var only=new AxBalancer(List.of(typed));
    var request=Map.<String,Object>of("chat_prompt",List.of(Map.of("role","user","content","reply")));
    try {only.validateChatRequest(request);throw new AssertionError("nested Typesafe accepted prose");} catch(IllegalArgumentException expected) {}
    only.validateChatRequest((Map<String,Object>)Json.parse("{\"chat_prompt\":[{\"role\":\"user\",\"content\":\"outage\"}],\"response_format\":{\"type\":\"json_schema\",\"schema\":{\"name\":\"decision\",\"schema\":{\"type\":\"object\",\"properties\":{\"urgent\":{\"type\":\"boolean\"}},\"required\":[\"urgent\"]}}}}"));
    var mixed=new AxBalancer(List.of(only,Ax.ai("openai",Map.of("api_key","test","models",List.of()))));
    mixed.validateChatRequest(request);
  }
  public static void main(String[] args)throws Exception{websocket();nativeClient();nestedValidation();System.out.println("Java Typesafe native client and MCP WebSocket cleanup passed");}
}
