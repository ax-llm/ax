package dev.axllm.ax;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.*;

/** Legacy MCP WebSocket transport, with request-local settlement and cleanup. */
public final class AxMCPWebSocketTransport implements AxMCPTransport {
  public interface Socket {
    void send(String text);
    String receive() throws Exception;
    void close();
  }
  @FunctionalInterface public interface SocketFactory { Socket connect(String url, List<String> protocols); }
  private final String url;
  private final List<String> protocols;
  private final SocketFactory factory;
  private final Object lock = new Object();
  private final Map<String, CompletableFuture<Map<String,Object>>> pending = new HashMap<>();
  private Socket socket;
  private String protocolVersion = "";
  private volatile Consumer<Map<String,Object>> handler;
  private volatile Function<Map<String,Object>,Map<String,Object>> requestHandler;
  private volatile Consumer<String> lifecycle;

  public AxMCPWebSocketTransport(String url) { this(url, List.of(), NativeSocket::new); }
  public AxMCPWebSocketTransport(String url, List<String> protocols, SocketFactory factory) {
    this.url=url; this.protocols=List.copyOf(protocols); this.factory=Objects.requireNonNull(factory);
  }
  public String eraHint() { return "legacy"; }
  public void setProtocolVersion(String version) { synchronized(lock) { protocolVersion=version; } }
  public void setMessageHandler(Consumer<Map<String,Object>> value) { handler=value; }
  public void setRequestHandler(Function<Map<String,Object>,Map<String,Object>> value) { requestHandler=value; }
  public void setLifecycleHandler(Consumer<String> value) { lifecycle=value; }
  public void connect() {
    synchronized(lock) {
      if(socket!=null) return;
      Socket current=Objects.requireNonNull(factory.connect(url, protocols));
      socket=current;
      Thread thread=new Thread(()->receive(current),"ax-mcp-websocket");thread.setDaemon(true);thread.start();
    }
  }
  public void startListening() { connect(); }
  private void receive(Socket current) {
    try {
      while(true) {
        String raw=current.receive();
        if(raw==null) throw new AxMCPError("MCP WebSocket closed");
        Object parsed=Json.parse(raw);
        synchronized(lock) {
          if(socket!=current)return;
          if(parsed instanceof List<?> && !"2025-03-26".equals(protocolVersion)) throw new AxMCPError("JSON-RPC batching is only allowed for MCP 2025-03-26");
        }
        for(Object item: parsed instanceof List<?> list ? list : List.of(parsed)) {
          Map<String,Object> message=Core.asMap(item);
          CompletableFuture<Map<String,Object>> slot=null;
          synchronized(lock) { if(socket!=current)return; if(message.containsKey("id")&&!message.containsKey("method"))slot=pending.remove(Json.stringify(message.get("id"))); }
          if(slot!=null)slot.complete(message);
          else CompletableFuture.runAsync(()->{
            if(message.containsKey("id")&&message.containsKey("method")&&requestHandler!=null)sendResponse(requestHandler.apply(message));
            else if(handler!=null)handler.accept(message);
          });
        }
      }
    } catch(Exception error) { terminate(current,error); }
  }
  private void terminate(Socket current, Throwable error) {
    List<CompletableFuture<Map<String,Object>>> requests;
    synchronized(lock) { if(socket!=current)return; socket=null;requests=new ArrayList<>(pending.values());pending.clear(); }
    for(var request:requests)request.completeExceptionally(error);
    current.close();
    if(lifecycle!=null)lifecycle.accept("disconnected");
  }
  private List<Map<String,Object>> requests(List<Map<String,Object>> messages, BooleanSupplier cancelled, boolean batch) {
    List<String> ids;
    synchronized(lock){ ids=Core.asList(Core.mcp_websocket_request_ids(messages,protocolVersion,batch)).stream().map(String::valueOf).toList(); }
    if(cancelled.getAsBoolean())throw new AxAIServiceAbortedError("MCP invocation cancelled");
    String payload=Json.stringify(batch?messages:messages.get(0));
    connect();
    List<CompletableFuture<Map<String,Object>>> slots=new ArrayList<>();
    Socket current;
    synchronized(lock) {
      for(String id:ids)if(pending.containsKey(id))throw new AxMCPError("MCP request ID is already pending");
      current=socket;if(current==null)throw new AxMCPError("MCP WebSocket closed");
      for(String id:ids){var slot=new CompletableFuture<Map<String,Object>>();pending.put(id,slot);slots.add(slot);}
    }
    try {
      if(cancelled.getAsBoolean())throw new AxAIServiceAbortedError("MCP invocation cancelled");
      current.send(payload);
      List<Map<String,Object>> results=new ArrayList<>();
      for(var slot:slots) {
        while(true) {
          if(cancelled.getAsBoolean())throw new AxAIServiceAbortedError("MCP invocation cancelled");
          try { results.add(slot.get(10,TimeUnit.MILLISECONDS));break; }
          catch(TimeoutException ignored) {}
        }
      }
      return results;
    } catch(InterruptedException error) { Thread.currentThread().interrupt();throw new AxAIServiceAbortedError("MCP request interrupted"); }
      catch(ExecutionException error) { throw new AxMCPError(error.getCause().getMessage()); }
    finally { synchronized(lock){for(int i=0;i<ids.size();i++)pending.remove(ids.get(i),slots.get(i));} }
  }
  public Map<String,Object> send(Map<String,Object> message) { return requests(List.of(message),()->false,false).get(0); }
  public Map<String,Object> sendWithContext(Map<String,Object> message,Map<String,String> headers,BooleanSupplier cancelled) { return requests(List.of(message),cancelled,false).get(0); }
  public List<Map<String,Object>> sendBatch(List<Map<String,Object>> messages,BooleanSupplier cancelled) { return requests(messages,cancelled,true); }
  public List<Map<String,Object>> sendBatch(List<Map<String,Object>> messages) { return sendBatch(messages,()->false); }
  public void sendNotification(Map<String,Object> message) { connect();Socket current;synchronized(lock){current=socket;}if(current==null)throw new AxMCPError("MCP WebSocket closed");current.send(Json.stringify(message)); }
  public void close() { Socket current;synchronized(lock){current=socket;}if(current!=null)terminate(current,new AxMCPError("MCP WebSocket closed")); }

  private static final class NativeSocket implements Socket, WebSocket.Listener {
    private final BlockingQueue<Object> messages=new LinkedBlockingQueue<>();
    private final StringBuilder partial=new StringBuilder();
    private final WebSocket socket;
    private final Object closed=new Object();
    NativeSocket(String url,List<String> protocols) {
      var builder=HttpClient.newHttpClient().newWebSocketBuilder().connectTimeout(Duration.ofSeconds(30));
      if(!protocols.isEmpty())builder.subprotocols(protocols.get(0),protocols.subList(1,protocols.size()).toArray(String[]::new));
      socket=builder.buildAsync(URI.create(url),this).join();
    }
    public void onOpen(WebSocket ws){ws.request(1);}
    public CompletionStage<?> onText(WebSocket ws,CharSequence data,boolean last){partial.append(data);if(last){messages.add(partial.toString());partial.setLength(0);}ws.request(1);return null;}
    public CompletionStage<?> onClose(WebSocket ws,int status,String reason){messages.offer(closed);return null;}
    public void onError(WebSocket ws,Throwable error){messages.offer(error);}
    public synchronized void send(String text){socket.sendText(text,true).join();}
    public String receive() throws Exception {Object item=messages.take();if(item==closed)return null;if(item instanceof Throwable error)throw new AxMCPError(error.getMessage());return (String)item;}
    public void close(){messages.offer(closed);socket.abort();}
  }
}
