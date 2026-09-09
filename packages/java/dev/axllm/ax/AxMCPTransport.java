package dev.axllm.ax;

import java.util.Map;

public interface AxMCPTransport {
  Map<String, Object> send(Map<String, Object> message);
  default Map<String, Object> sendWithHeaders(Map<String, Object> message, Map<String, String> headers) { return send(message); }
  default Map<String,Object> sendWithContext(Map<String,Object> message,Map<String,String> headers,java.util.function.BooleanSupplier cancelled) {
    if(cancelled.getAsBoolean())throw new AxAIServiceAbortedError("MCP invocation cancelled");
    Map<String,Object> result=sendWithHeaders(message,headers);
    if(cancelled.getAsBoolean())throw new AxAIServiceAbortedError("MCP invocation cancelled");
    return result;
  }
  void sendNotification(Map<String, Object> message);
  default void sendResponse(Map<String, Object> message) { sendNotification(message); }
  default void setMessageHandler(java.util.function.Consumer<Map<String, Object>> handler) {}
  default void setRequestHandler(java.util.function.Function<Map<String, Object>, Map<String, Object>> handler) {}
  default void setLifecycleHandler(java.util.function.Consumer<String> handler) {}
  default void setProtocolVersion(String protocolVersion) {}
  default void setEra(String era) {}
  default String eraHint() { return null; }
  default String eraCacheKey() { return null; }
  default void connect() {}
  default void startListening() {}
  default void openRequestStream(Map<String, Object> message) { throw new AxMCPError("Request streams are only available for modern MCP"); }
  default void closeRequestStream() {}
  default void close() {}
}
