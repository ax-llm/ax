package dev.axllm.ax;

import java.util.Map;

public final class OpenAIResponsesClient extends OpenAICompatibleClient {
  public OpenAIResponsesClient(String model) {
    this(Map.of("model", model));
  }

  public OpenAIResponsesClient(Map<String, Object> options) {
    super("openai-responses", "openai-responses", options == null ? Map.of() : options, "gpt-4o", "text-embedding-ada-002");
  }
}
