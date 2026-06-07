package dev.axllm.ax;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

public final class AxMCPScriptedTransport implements AxMCPTransport {
  public final List<Object> responses;
  public final List<Map<String, Object>> requests = new ArrayList<>();
  public final List<Map<String, Object>> notifications = new ArrayList<>();
  public final List<Map<String, Object>> sentResponses = new ArrayList<>();
  private Consumer<Map<String, Object>> handler;
  public String protocolVersion;

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

  public void sendNotification(Map<String, Object> message) { notifications.add(new LinkedHashMap<>(message)); }
  public void sendResponse(Map<String, Object> message) { sentResponses.add(new LinkedHashMap<>(message)); }
  public void setMessageHandler(Consumer<Map<String, Object>> handler) { this.handler = handler; }
  public void setProtocolVersion(String protocolVersion) { this.protocolVersion = protocolVersion; }
  public void emit(Map<String, Object> message) { if (handler != null) handler.accept(message); }
}
