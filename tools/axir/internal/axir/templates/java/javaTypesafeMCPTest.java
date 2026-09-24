import dev.axllm.ax.*;
import java.nio.charset.StandardCharsets;
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
  static byte[] frame(int head,byte[] payload){var out=new java.io.ByteArrayOutputStream();out.write(head);out.write(payload.length);out.writeBytes(payload);return out.toByteArray();}
  // Minimal WebSocket server: completes one handshake, reads the request frame, then replies with a
  // binary message in two fragments that split the two-byte UTF-8 "é".
  static Void binaryPeer(java.net.ServerSocket server)throws Exception{
    try(var client=server.accept()){
      var in=new java.io.DataInputStream(client.getInputStream());var out=client.getOutputStream();var head=new StringBuilder();
      while(!head.toString().endsWith("\r\n\r\n")){int next=in.read();if(next<0)throw new java.io.EOFException("handshake");head.append((char)next);}
      var key=java.util.regex.Pattern.compile("(?i)sec-websocket-key: *(\\S+)").matcher(head);check(key.find(),"handshake has no key");
      var accept=Base64.getEncoder().encodeToString(java.security.MessageDigest.getInstance("SHA-1").digest((key.group(1)+"258EAFA5-E914-47DA-95CA-C5AB0DC85B11").getBytes(StandardCharsets.US_ASCII)));
      out.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: "+accept+"\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
      in.readUnsignedByte();int length=in.readUnsignedByte()&0x7f;if(length==126)length=in.readUnsignedShort();in.readNBytes(4+length);
      byte[] reply="{\"id\":1,\"result\":\"café\"}".getBytes(StandardCharsets.UTF_8);int cut=0;while(reply[cut]!=(byte)0xC3)cut++;cut++;
      out.write(frame(0x02,Arrays.copyOfRange(reply,0,cut)));out.write(frame(0x80,Arrays.copyOfRange(reply,cut,reply.length)));out.flush();
      in.read();return null;
    }
  }
  static void nativeBinaryFrames()throws Exception{
    var pool=Executors.newFixedThreadPool(2);
    try(var server=new java.net.ServerSocket(0,1,java.net.InetAddress.getLoopbackAddress())){
      server.setSoTimeout(5000);var peer=pool.submit(()->binaryPeer(server));
      var transport=new AxMCPWebSocketTransport("ws://127.0.0.1:"+server.getLocalPort());
      try{var reply=pool.submit(()->transport.send(Map.of("id",1,"method","ping")));check("café".equals(reply.get(5,TimeUnit.SECONDS).get("result")),"binary reply");}
      finally{transport.close();}
      peer.get(5,TimeUnit.SECONDS);
    }finally{pool.shutdownNow();}
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
  static void combinedCancellation() throws Exception {
    var parent = new AxCancellationToken(); var perCall = new AxCancellationToken();
    var calls = new AtomicInteger();
    OpenAICompatibleClient.Transport transport = request -> {calls.incrementAndGet(); return Map.of("models",List.of());};
    var client = Ax.typesafe(Map.of("api_key","test","transport",transport,"cancellation",parent));
    client.listModels(Map.of("cancellationToken",perCall));
    check(parent.subscriptionCount()==0 && perCall.subscriptionCount()==0,"success leaked cancellation subscriptions");
    parent.cancel("instance cancelled");
    try {client.listModels(Map.of("cancellation",perCall)); throw new AssertionError("cancelled instance accepted");}
    catch (AxAIServiceAbortedError expected) {}
    check(calls.get()==1,"cancelled instance accessed transport");
    check(parent.subscriptionCount()==0 && perCall.subscriptionCount()==0,"pre-abort leaked subscriptions");
    for (boolean cancelParent : List.of(true,false)) {
      var inherited = new AxCancellationToken(); var local = new AxCancellationToken();
      var started = new CountDownLatch(1); var attempts = new AtomicInteger();
      OpenAICompatibleClient.Transport retrying = request -> {
        int attempt=attempts.incrementAndGet();started.countDown();
        return attempt==1 ? Map.of("status",429,"json",Map.of("error","retry")) : Map.of("models",List.of());
      };
      var retryClient=Ax.typesafe(Map.of("api_key","test","transport",retrying,"cancellation",inherited,"retry",Map.of("maxRetries",1,"initialDelayMs",5000)));
      var pool=Executors.newSingleThreadExecutor();
      try {
        var task=pool.submit(()->retryClient.listModels(Map.of("cancellation",local)));
        check(started.await(2,TimeUnit.SECONDS),"request did not start");
        (cancelParent ? inherited : local).cancel("cancel pending retry");
        error(task,"cancel pending retry");
        check(attempts.get()==1,"cancelled request retried");
        check(inherited.subscriptionCount()==0 && local.subscriptionCount()==0,"retry leaked cancellation subscriptions");
        if(!cancelParent){check(!inherited.cancelled(),"call cancellation poisoned client");retryClient.listModels();}
      } finally {pool.shutdownNow();}
    }
  }
  static void lateServerReply() throws Exception {
    var sockets=new CopyOnWriteArrayList<Socket>();
    var transport=new AxMCPWebSocketTransport("ws://example.test",List.of(),(url,protocols)->{var socket=new Socket();sockets.add(socket);return socket;});
    var started=new CountDownLatch(1);var release=new CountDownLatch(1);
    transport.setRequestHandler(message->{started.countDown();try{check(release.await(2,TimeUnit.SECONDS),"handler timed out");}catch(InterruptedException error){throw new RuntimeException(error);}return Map.of("id",message.get("id"),"result",Map.of());});
    try {
      transport.startListening();sockets.get(0).inbound.add("{\"id\":\"server-1\",\"method\":\"roots/list\"}");
      check(started.await(2,TimeUnit.SECONDS),"server request was not dispatched");
      transport.close();release.countDown();
      check(ForkJoinPool.commonPool().awaitQuiescence(2,TimeUnit.SECONDS),"server handler did not settle");
      check(sockets.size()==1 && sockets.get(0).sent.isEmpty(),"late server reply reopened the closed transport");
    } finally {release.countDown();transport.close();}
  }
  public static void main(String[] args)throws Exception{websocket();nativeBinaryFrames();nativeClient();nestedValidation();combinedCancellation();lateServerReply();System.out.println("Java Typesafe native client and MCP WebSocket cleanup passed");}
}
