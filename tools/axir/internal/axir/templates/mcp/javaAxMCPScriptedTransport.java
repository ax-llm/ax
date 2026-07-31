package dev.axllm.ax;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;
import java.util.function.Function;

public final class AxMCPScriptedTransport implements AxMCPTransport {
  public final List<Object> responses;
  public final List<Map<String, Object>> requests = new ArrayList<>();
  public final List<Map<String, Object>> notifications = new ArrayList<>();
  public final List<Map<String, Object>> sentResponses = new ArrayList<>();
  public final List<Map<String, String>> requestHeaders = new ArrayList<>();
  public final List<Map<String, Object>> requestStreams = new ArrayList<>();
  private Consumer<Map<String, Object>> handler;
  private Function<Map<String, Object>, Map<String, Object>> requestHandler;
  public String protocolVersion;
  public String era;

  public AxMCPScriptedTransport(List<Object> responses) {
    this.responses = new ArrayList<>(responses == null ? List.of() : responses);
  }

  public Map<String, Object> send(Map<String, Object> message) {
    requests.add(new LinkedHashMap<>(message));
    String method = String.valueOf(message.get("method"));
    int match = -1;
    for (int i = 0; i < responses.size(); i++) {
      Map<String, Object> raw = Core.asMap(responses.get(i));
      if (method.equals(String.valueOf(raw.getOrDefault("method", method)))) { match = i; break; }
    }
    Map<String, Object> raw = match >= 0 ? Core.asMap(responses.remove(match)) : Map.of("result", Map.of());
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("jsonrpc", "2.0");
    out.put("id", message.get("id"));
    if (raw.containsKey("error")) out.put("error", raw.get("error"));
    else out.put("result", raw.getOrDefault("result", Map.of()));
    return out;
  }

  public Map<String,Object> sendWithHeaders(Map<String,Object> message,Map<String,String> headers){requestHeaders.add(new LinkedHashMap<>(headers));return send(message);}

  public void sendNotification(Map<String, Object> message) { notifications.add(new LinkedHashMap<>(message)); }
  public void sendResponse(Map<String, Object> message) { sentResponses.add(new LinkedHashMap<>(message)); }
  public void setMessageHandler(Consumer<Map<String, Object>> handler) { this.handler = handler; }
  public void setRequestHandler(Function<Map<String, Object>, Map<String, Object>> handler) { this.requestHandler = handler; }
  public void setProtocolVersion(String protocolVersion) { this.protocolVersion = protocolVersion; }
  public void setEra(String era) { this.era = era; }
  public void openRequestStream(Map<String,Object> message){if(!"modern".equals(era))throw new AxMCPError("Request streams are only available for modern MCP");Map<String,Object> request=new LinkedHashMap<>(message);requestStreams.add(request);Map<String,Object> params=Core.asMap(request.get("params"));emit(new LinkedHashMap<>(Map.of("jsonrpc","2.0","method","notifications/subscriptions/acknowledged","params",new LinkedHashMap<>(Map.of("notifications",params.getOrDefault("notifications",Map.of()),"_meta",Map.of("io.modelcontextprotocol/subscriptionId",request.get("id")))))));}
  public void emit(Map<String, Object> message) { if(message.containsKey("id")&&message.containsKey("method")&&requestHandler!=null){sendResponse(requestHandler.apply(message));return;}if (handler != null) handler.accept(message); }
}
