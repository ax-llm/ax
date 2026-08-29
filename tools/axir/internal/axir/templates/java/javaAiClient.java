package dev.axllm.ax;

import java.util.Map;

public interface AiClient {
  Map<String, Object> complete(Map<String, Object> request) throws Exception;

  default Map<String, Object> chat(Map<String, Object> request) throws Exception {
    return Core.legacyResponseToChatResponse(complete(request));
  }

  default Iterable<Map<String, Object>> stream(Map<String, Object> request) throws Exception {
    return AxChatStream.lazy(() -> AxChatStream.fromIterable(java.util.List.of(chat(request))));
  }

  default AxChatStream openStream(Map<String, Object> request) throws Exception {
    Iterable<Map<String, Object>> values = stream(request);
    return values instanceof AxChatStream chatStream ? chatStream : AxChatStream.fromIterable(values);
  }

  default Map<String, Object> transcribe(Map<String, Object> request, Map<String, Object> options) throws Exception {
    return Map.of("text", "");
  }
}
