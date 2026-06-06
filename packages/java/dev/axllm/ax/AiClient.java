package dev.axllm.ax;

import java.util.Map;

public interface AiClient {
  Map<String, Object> complete(Map<String, Object> request) throws Exception;

  default Map<String, Object> chat(Map<String, Object> request) throws Exception {
    return Core.legacyResponseToChatResponse(complete(request));
  }

  default Iterable<Map<String, Object>> stream(Map<String, Object> request) throws Exception {
    return java.util.List.of(chat(request));
  }
}
