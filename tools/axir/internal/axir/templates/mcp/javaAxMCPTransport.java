package dev.axllm.ax;

import java.util.Map;

public interface AxMCPTransport {
  Map<String, Object> send(Map<String, Object> message);
  void sendNotification(Map<String, Object> message);
  default void sendResponse(Map<String, Object> message) { sendNotification(message); }
  default void setMessageHandler(java.util.function.Consumer<Map<String, Object>> handler) {}
  default void setProtocolVersion(String protocolVersion) {}
  default void connect() {}
}
