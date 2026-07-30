package dev.axllm.ax;

import java.util.Map;

public interface AxMCPTransport {
  Map<String, Object> send(Map<String, Object> message);
  default Map<String, Object> sendWithHeaders(Map<String, Object> message, Map<String, String> headers) { return send(message); }
  void sendNotification(Map<String, Object> message);
  default void sendResponse(Map<String, Object> message) { sendNotification(message); }
  default void setMessageHandler(java.util.function.Consumer<Map<String, Object>> handler) {}
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
