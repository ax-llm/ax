package dev.axllm.ax;

public final class Ax {
  public static AxSignature s(String signature) {
    return AxSignature.create(signature);
  }

  public static Field.Factory f() {
    return new Field.Factory();
  }

  public static Tool.Builder fn(String name) {
    return new Tool.Builder(name);
  }

  public static AxGen ax(String signature) {
    return new AxGen(AxSignature.create(signature));
  }

  public static AxGen ax(AxSignature signature) {
    return new AxGen(signature);
  }

  public static AxAgent agent(String signature, java.util.Map<String, Object> options) {
    return new AxAgent(signature, options == null ? java.util.Map.of() : options);
  }

  public static AxAgent agent(AxSignature signature, java.util.Map<String, Object> options) {
    return new AxAgent(signature, options == null ? java.util.Map.of() : options);
  }

  public static AxFlow flow() {
    return new AxFlow(java.util.Map.of());
  }

  public static AxFlow flow(java.util.Map<String, Object> options) {
    return new AxFlow(options == null ? java.util.Map.of() : options);
  }

  public static AxAIService ai(String provider, java.util.Map<String, Object> options) {
    java.util.Map<String, Object> resolved = Core.asMap(Core.provider_resolve_profile(provider == null ? "openai" : provider));
    if (!Core.truthy(resolved.get("known"))) {
      throw new IllegalArgumentException("unsupported AxAI provider: " + provider);
    }
    String canonical = String.valueOf(resolved.get("id"));
    if (canonical.equals("openai-compatible")) {
      return new OpenAICompatibleClient(options == null ? java.util.Map.of() : options);
    }
    if (canonical.equals("openai-responses")) {
      return new OpenAIResponsesClient(options == null ? java.util.Map.of() : options);
    }
    if (canonical.equals("google-gemini")) {
      return new GoogleGeminiClient(options == null ? java.util.Map.of() : options);
    }
    if (canonical.equals("anthropic")) {
      return new AnthropicClient(options == null ? java.util.Map.of() : options);
    }
    if (canonical.equals("azure-openai")) {
      return new AzureOpenAIClient(options == null ? java.util.Map.of() : options);
    }
    if (canonical.equals("deepseek")) {
      return new DeepSeekClient(options == null ? java.util.Map.of() : options);
    }
    if (canonical.equals("mistral")) {
      return new MistralClient(options == null ? java.util.Map.of() : options);
    }
    if (canonical.equals("reka")) {
      return new RekaClient(options == null ? java.util.Map.of() : options);
    }
    if (canonical.equals("cohere")) {
      return new CohereClient(options == null ? java.util.Map.of() : options);
    }
    if (canonical.equals("grok")) {
      return new GrokClient(options == null ? java.util.Map.of() : options);
    }
    throw new IllegalArgumentException("unsupported AxAI provider: " + provider);
  }

  public static java.util.List<Object> getSupportedAIModels() {
    return Core.asList(Core.provider_model_catalog(java.util.Map.of()));
  }

  public static java.util.List<Object> getSupportedAIModels(String type) {
    return Core.asList(Core.provider_model_catalog(type == null ? java.util.Map.of() : java.util.Map.of("type", type)));
  }

  private Ax() {}
}
