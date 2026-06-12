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

  public static java.util.Map<String, Object> optimize(AxGen program, java.util.List<java.util.Map<String, Object>> examples, java.util.Map<String, Object> options) {
    return optimizeProgram(program, examples, options);
  }

  public static java.util.Map<String, Object> optimize(AxFlow program, java.util.List<java.util.Map<String, Object>> examples, java.util.Map<String, Object> options) {
    return optimizeProgram(program, examples, options);
  }

  public static java.util.Map<String, Object> optimize(AxAgent program, java.util.List<java.util.Map<String, Object>> examples, java.util.Map<String, Object> options) {
    return optimizeProgram(program, examples, options);
  }

  private static java.util.Map<String, Object> optimizeProgram(Object program, java.util.List<java.util.Map<String, Object>> examples, java.util.Map<String, Object> options) {
    java.util.Map<String, Object> opts = options == null ? java.util.Map.of() : options;
    Object student = option(opts, "studentAI", "student_ai", "student", "client", "ai");
    if (!(student instanceof AiClient studentClient)) throw new IllegalArgumentException("optimize() requires studentAI or client");
    Object teacher = option(opts, "teacherAI", "teacher_ai", "teacher", "reflectionAI", "reflection_ai", "reflection_client");
    AiClient teacherClient = teacher instanceof AiClient aiClient ? aiClient : studentClient;
    java.util.List<java.util.Map<String, Object>> data = examples == null ? java.util.List.of() : examples;
    Object bootstrapSetting = opts.containsKey("bootstrap") ? opts.get("bootstrap") : Boolean.valueOf(data.size() <= 8);
    Object demos = java.util.List.of();
    if (!Boolean.FALSE.equals(bootstrapSetting)) {
      java.util.Map<String, Object> bootstrapOptions = new java.util.LinkedHashMap<>(opts);
      if (bootstrapSetting instanceof java.util.Map<?, ?> map) bootstrapOptions.putAll(Core.asMap(map));
      bootstrapOptions.put("client", teacherClient);
      bootstrapOptions.put("apply", false);
      AxBootstrapFewShot bootstrap = new AxBootstrapFewShot(bootstrapOptions);
      java.util.Map<String, Object> bootstrapArtifact = optimizeWith(program, bootstrap, data, bootstrapOptions);
      demos = bootstrapArtifact.getOrDefault("demos", java.util.List.of());
      applyDemos(program, demos);
    }
    java.util.Map<String, Object> gepaOptions = new java.util.LinkedHashMap<>(opts);
    gepaOptions.put("bootstrap", false);
    gepaOptions.put("maxMetricCalls", ((Number) opts.getOrDefault("maxMetricCalls", opts.getOrDefault("max_metric_calls", 100))).intValue());
    gepaOptions.put("client", studentClient);
    gepaOptions.put("apply", false);
    AxGEPA gepa = new AxGEPA(teacherClient, gepaOptions);
    java.util.Map<String, Object> artifact = optimizeWith(program, gepa, data, gepaOptions);
    if (demos instanceof java.util.List<?> list && !list.isEmpty()) artifact.put("demos", demos);
    return artifact;
  }

  private static java.util.Map<String, Object> optimizeWith(Object program, OptimizerEngine engine, java.util.List<java.util.Map<String, Object>> examples, java.util.Map<String, Object> options) {
    if (program instanceof AxGen gen) return gen.optimizeWith(engine, examples, options);
    if (program instanceof AxFlow flow) return flow.optimizeWith(engine, examples, options);
    if (program instanceof AxAgent agent) return agent.optimizeWith(engine, examples, options);
    throw new IllegalArgumentException("optimize() program must be AxGen, AxFlow, or AxAgent");
  }

  private static Object option(java.util.Map<String, Object> options, String... keys) {
    for (String key : keys) if (options.containsKey(key) && options.get(key) != null) return options.get(key);
    return null;
  }

  private static void applyDemos(Object program, Object demos) {
    if (program instanceof AxGen gen) gen.setDemos(Core.asMapList(demos));
    if (program instanceof AxFlow flow) flow.setDemos(demos);
  }

  public static java.util.List<Object> getSupportedAIModels() {
    return Core.asList(Core.provider_model_catalog(java.util.Map.of()));
  }

  public static java.util.List<Object> getSupportedAIModels(String type) {
    return Core.asList(Core.provider_model_catalog(type == null ? java.util.Map.of() : java.util.Map.of("type", type)));
  }

  private Ax() {}
}
