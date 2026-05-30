package axir

const javaAx = `package dev.ax;

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
    String normalized = provider == null ? "openai" : provider.replace("-", "_").toLowerCase();
    if (normalized.equals("openai") || normalized.equals("openai_compatible") || normalized.equals("compatible")) {
      return new OpenAICompatibleClient(options == null ? java.util.Map.of() : options);
    }
    throw new IllegalArgumentException("unsupported AxAI provider: " + provider);
  }

  private Ax() {}
}
`

const javaAxProgram = `package dev.ax;

import java.util.List;
import java.util.Map;

public interface AxProgram {
  Map<String, Object> forward(AiClient client, Map<String, Object> values, Map<String, Object> options);
  List<Map<String, Object>> getOptimizableComponents();
  default AxProgram applyOptimizedComponents(Map<String, Object> componentMap) { return this; }
  default List<Map<String, Object>> getTraces() { return List.of(); }
  default List<?> getChatLog() { return List.of(); }
  default Object getUsage() { return Map.of(); }
}
`

const javaFieldType = `package dev.ax;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class FieldType {
  public String name;
  public boolean array;
  public List<String> options;
  public Map<String, Object> fields;
  public Integer minLength;
  public Integer maxLength;
  public Double minimum;
  public Double maximum;
  public String pattern;
  public String patternDescription;
  public String format;
  public String description;

  public FieldType(String name) {
    this.name = name == null || name.isBlank() ? "string" : name;
  }

  public FieldType copy() {
    FieldType out = new FieldType(name);
    out.array = array;
    out.options = options == null ? null : List.copyOf(options);
    out.fields = fields == null ? null : new LinkedHashMap<>(fields);
    out.minLength = minLength;
    out.maxLength = maxLength;
    out.minimum = minimum;
    out.maximum = maximum;
    out.pattern = pattern;
    out.patternDescription = patternDescription;
    out.format = format;
    out.description = description;
    return out;
  }
}
`

const javaField = `package dev.ax;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class Field {
  public final String name;
  public final FieldType type;
  public final String description;
  public final String title;
  public final boolean optional;
  public final boolean internal;
  public final boolean cached;

  public Field(String name, FieldType type, String description, String title, boolean optional, boolean internal, boolean cached) {
    this.name = name;
    this.type = type == null ? new FieldType("string") : type;
    this.description = description;
    this.title = title == null ? Core.title(name) : title;
    this.optional = optional;
    this.internal = internal;
    this.cached = cached;
  }

  public Field(String name, FieldType type, String description, boolean optional, boolean internal, boolean cached) {
    this(name, type, description, null, optional, internal, cached);
  }

  public static final class Fluent {
    private FieldType type;
    private String description;
    private String itemDescription;
    private boolean optional;
    private boolean internal;
    private boolean cached;

    Fluent(String type, String description) {
      this.type = new FieldType(type);
      this.description = description;
      this.itemDescription = description;
    }

    Fluent(FieldType type, String description, String itemDescription, boolean optional, boolean internal, boolean cached) {
      this.type = type;
      this.description = description;
      this.itemDescription = itemDescription;
      this.optional = optional;
      this.internal = internal;
      this.cached = cached;
    }

    public Fluent optional() { Fluent out = copy(); out.optional = true; return out; }
    public Fluent internal() { Fluent out = copy(); out.internal = true; return out; }
    public Fluent cache() { Fluent out = copy(); out.cached = true; return out; }
    public Fluent array() { return array(null); }
    public Fluent array(String description) {
      Fluent out = copy();
      out.type.array = true;
      if (out.itemDescription != null && out.type.description == null) out.type.description = out.itemDescription;
      if (description != null) out.description = description;
      return out;
    }
    public Fluent min(int value) {
      Fluent out = copy();
      if ("number".equals(out.type.name)) out.type.minimum = (double) value;
      else out.type.minLength = value;
      return out;
    }
    public Fluent max(int value) {
      Fluent out = copy();
      if ("number".equals(out.type.name)) out.type.maximum = (double) value;
      else out.type.maxLength = value;
      return out;
    }
    public Fluent email() { Fluent out = copy(); out.type.format = "email"; return out; }
    public Fluent url() { Fluent out = copy(); out.type.format = "uri"; return out; }
    public Fluent regex(String pattern, String patternDescription) {
      if (patternDescription == null || patternDescription.isBlank()) throw new AxSignatureError("regex() requires a pattern description");
      Fluent out = copy();
      out.type.pattern = pattern;
      out.type.patternDescription = patternDescription;
      return out;
    }

    Field toField(String name) {
      return new Field(name, type.copy(), description, null, optional, internal, cached);
    }

    FieldType toType() {
      return type.copy();
    }

    private Fluent copy() {
      return new Fluent(type.copy(), description, itemDescription, optional, internal, cached);
    }
  }

  public static final class Factory {
    public AxSignature.Builder call() { return new AxSignature.Builder(); }
    public Fluent string() { return string(null); }
    public Fluent string(String description) { return new Fluent("string", description); }
    public Fluent number() { return number(null); }
    public Fluent number(String description) { return new Fluent("number", description); }
    public Fluent boolean_() { return boolean_(null); }
    public Fluent boolean_(String description) { return new Fluent("boolean", description); }
    public Fluent json() { return json(null); }
    public Fluent json(String description) { return new Fluent("json", description); }
    public Fluent date() { return date(null); }
    public Fluent date(String description) { return new Fluent("date", description); }
    public Fluent datetime() { return datetime(null); }
    public Fluent datetime(String description) { return new Fluent("datetime", description); }
    public Fluent dateRange() { return dateRange(null); }
    public Fluent dateRange(String description) { return new Fluent("dateRange", description); }
    public Fluent datetimeRange() { return datetimeRange(null); }
    public Fluent datetimeRange(String description) { return new Fluent("datetimeRange", description); }
    public Fluent image() { return image(null); }
    public Fluent image(String description) { return new Fluent("image", description); }
    public Fluent audio() { return audio(null); }
    public Fluent audio(String description) { return new Fluent("audio", description); }
    public Fluent file() { return file(null); }
    public Fluent file(String description) { return new Fluent("file", description); }
    public Fluent url() { return url(null); }
    public Fluent url(String description) { return new Fluent("url", description); }
    public Fluent code() { return code(null); }
    public Fluent code(String description) { return new Fluent("code", description); }
    public Fluent object(Map<String, Fluent> fields) { return object(fields, null); }
    public Fluent object(Map<String, Fluent> fields, String description) {
      FieldType t = new FieldType("object");
      t.fields = new LinkedHashMap<>();
      if (fields != null) {
        for (Map.Entry<String, Fluent> entry : fields.entrySet()) {
          Field nested = entry.getValue().toField(entry.getKey());
          if (nested.description != null && nested.type.description == null) nested.type.description = nested.description;
          t.fields.put(entry.getKey(), nested);
        }
      }
      return new Fluent(t, description, description, false, false, false);
    }
    public Fluent classification(List<String> options) { return classification(options, null); }
    public Fluent classification(List<String> options, String description) {
      if (options == null || options.isEmpty()) throw new AxSignatureError("classification() requires at least one option");
      FieldType t = new FieldType("class");
      t.options = List.copyOf(options);
      return new Fluent(t, description, description, false, false, false);
    }
  }
}
`

const javaSignature = `package dev.ax;

import java.util.ArrayList;
import java.util.List;

public final class AxSignature {
  public final String description;
  public final List<Field> inputs;
  public final List<Field> outputs;
  public boolean forceStructured;

  public AxSignature(String description, List<Field> inputs, List<Field> outputs) {
    this.description = description;
    this.inputs = List.copyOf(inputs == null ? List.of() : inputs);
    this.outputs = List.copyOf(outputs == null ? List.of() : outputs);
    Core.validate_signature(this);
  }

  public static AxSignature create(String signature) {
    return (AxSignature) Core.parse_signature(signature);
  }

  public List<Field> getInputFields() { return inputs; }
  public List<Field> getOutputFields() { return outputs; }
  public String getDescription() { return description; }

  public boolean hasComplexFields() {
    if (forceStructured) return true;
    for (Field field : outputs) {
      if ("object".equals(field.type.name) || field.type.fields != null) return true;
    }
    return false;
  }

  public java.util.Map<String, Object> toJsonSchema(String target, java.util.Map<String, Object> options) {
    List<Field> fields = "inputs".equals(target) ? inputs : outputs;
    return Core.asMap(Core.to_json_schema(fields, "Schema", options == null ? java.util.Map.of() : options));
  }

  public static final class Builder {
    private final List<Field> inputs = new ArrayList<>();
    private final List<Field> outputs = new ArrayList<>();
    private String description;
    private boolean forceStructured;

    public Builder input(String name, Field.Fluent field) { inputs.add(field.toField(name)); return this; }
    public Builder output(String name, Field.Fluent field) { outputs.add(field.toField(name)); return this; }
    public Builder description(String text) { description = text; return this; }
    public Builder useStructured() { forceStructured = true; return this; }
    public AxSignature build() {
      AxSignature sig = new AxSignature(description, inputs, outputs);
      sig.forceStructured = forceStructured;
      return sig;
    }
  }
}

class AxSignatureError extends IllegalArgumentException {
  AxSignatureError(String message) { super(message); }
}
`

const javaTool = `package dev.ax;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

public final class Tool {
  public interface Handler {
    Object call(Map<String, Object> args) throws Exception;
  }

  public final String name;
  public final String description;
  public final List<Field> args;
  public final List<Field> returns;
  public final Handler handler;

  Tool(String name, String description, List<Field> args, List<Field> returns, Handler handler) {
    this.name = name;
    this.description = description;
    this.args = List.copyOf(args);
    this.returns = List.copyOf(returns);
    this.handler = handler;
  }

  public Map<String, Object> schema() {
    return Core.asMap(Core.to_json_schema(args, "Schema", java.util.Map.of()));
  }

  public Object call(Map<String, Object> values) {
    Core.validate_fields(args, values, "tool." + name + ".args");
    try {
      Object result = handler.call(values);
      if (!returns.isEmpty() && result instanceof Map<?, ?> map) Core.validate_fields(returns, map, "tool." + name + ".return");
      return result;
    } catch (RuntimeException e) {
      throw e;
    } catch (Exception e) {
      throw new RuntimeException(e.getMessage(), e);
    }
  }

  public static final class Builder {
    private final String name;
    private String description;
    private final List<Field> args = new ArrayList<>();
    private final List<Field> returns = new ArrayList<>();
    private Handler handler;

    public Builder(String name) { this.name = name; }
    public Builder description(String text) { description = text; return this; }
    public Builder arg(String name, Field.Fluent field) { args.add(field.toField(name)); return this; }
    public Builder returnsField(String name, Field.Fluent field) { returns.add(field.toField(name)); return this; }
    public Builder handler(Handler handler) { this.handler = handler; return this; }
    public Tool build() {
      if (name == null || name.isBlank()) throw new IllegalArgumentException("fn() requires a non-empty function name");
      if (description == null || description.isBlank()) throw new IllegalArgumentException("Function '" + name + "' must define a description");
      if (handler == null) throw new IllegalArgumentException("Function '" + name + "' must define a handler");
      return new Tool(name, description, args, returns, handler);
    }
  }
}
`

const javaPromptTemplate = `package dev.ax;

import java.util.List;
import java.util.Map;

public final class PromptTemplate {
  private final AxSignature signature;
  private final List<Tool> tools;
  private final String structuredOutputFunctionName;
  private final String customTemplate;
  private String instruction;

  public PromptTemplate(AxSignature signature, List<Tool> tools) {
    this(signature, tools, null, null);
  }

  public PromptTemplate(AxSignature signature, List<Tool> tools, String structuredOutputFunctionName, String customTemplate) {
    this.signature = signature;
    this.tools = tools == null ? List.of() : List.copyOf(tools);
    this.structuredOutputFunctionName = structuredOutputFunctionName;
    this.customTemplate = customTemplate;
  }

  public void setInstruction(String instruction) { this.instruction = instruction; }

  public List<Map<String, Object>> render(Map<String, Object> values) {
    java.util.Map<String, Object> options = new java.util.LinkedHashMap<>();
    if (instruction != null) options.put("instruction", instruction);
    if (structuredOutputFunctionName != null) options.put("structured_output_function_name", structuredOutputFunctionName);
    if (customTemplate != null) options.put("custom_template", customTemplate);
    return Core.asMapList(Core.render_prompt(signature, values == null ? java.util.Map.of() : values, tools, options));
  }
}
`

const javaAiClient = `package dev.ax;

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
`

const javaAxAIService = `package dev.ax;

import java.util.Map;

public interface AxAIService extends AiClient {
  String getId();
  String getName();
  Map<String, Object> getFeatures(String model);
  Map<String, Object> getMetrics();
  String getLastUsedChatModel();
  String getLastUsedEmbedModel();
  Map<String, Object> getLastUsedModelConfig();
  void setOptions(Map<String, Object> options);
  Map<String, Object> getOptions();
  Map<String, Object> embed(Map<String, Object> request) throws Exception;

  default Map<String, Object> transcribe(Map<String, Object> request) {
    throw new AxUnsupportedCapabilityError("transcribe is not supported by this generated AxAI beta provider");
  }

  default Map<String, Object> speak(Map<String, Object> request) {
    throw new AxUnsupportedCapabilityError("speak is not supported by this generated AxAI beta provider");
  }
}
`

const javaAxBaseAI = `package dev.ax;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

public abstract class AxBaseAI implements AxAIService {
  protected final String id = UUID.randomUUID().toString();
  protected final String name;
  protected final String model;
  protected final String embedModel;
  protected Map<String, Object> modelConfig;
  protected Map<String, Object> options;
  protected String lastUsedChatModel;
  protected String lastUsedEmbedModel;
  protected Map<String, Object> lastUsedModelConfig;

  protected AxBaseAI(String name, String model, String embedModel, Map<String, Object> modelConfig, Map<String, Object> options) {
    if (model == null || model.isBlank()) throw new IllegalArgumentException("No model defined");
    this.name = name;
    this.model = model;
    this.embedModel = embedModel;
    this.modelConfig = new LinkedHashMap<>();
    this.modelConfig.put("temperature", 0);
    if (modelConfig != null) this.modelConfig.putAll(modelConfig);
    this.options = new LinkedHashMap<>(options == null ? Map.of() : options);
  }

  public String getId() { return id; }
  public String getName() { return name; }
  public Map<String, Object> getFeatures(String model) { return Core.defaultFeatures(); }
  public Map<String, Object> getMetrics() { return new LinkedHashMap<>(); }
  public String getLastUsedChatModel() { return lastUsedChatModel; }
  public String getLastUsedEmbedModel() { return lastUsedEmbedModel; }
  public Map<String, Object> getLastUsedModelConfig() { return lastUsedModelConfig == null ? null : new LinkedHashMap<>(lastUsedModelConfig); }
  public void setOptions(Map<String, Object> options) { this.options = new LinkedHashMap<>(options == null ? Map.of() : options); }
  public Map<String, Object> getOptions() { return new LinkedHashMap<>(options); }

  public Map<String, Object> chat(Map<String, Object> request) throws Exception {
    Map<String, Object> req = Core.coerceChatRequest(request);
    Core.validate_chat_request(req);
    Map<String, Object> mergedOptions = Core.asMap(Core.mapMerge(options, java.util.Map.of()));
    Object rawModel = req.get("model");
    String selectedModel = rawModel == null ? model : String.valueOf(rawModel);
    Map<String, Object> mergedConfig = Core.asMap(Core.merge_model_config(modelConfig, req.get("model_config"), mergedOptions));
    if (mergedOptions.containsKey("stream")) mergedConfig.put("stream", Boolean.TRUE.equals(mergedOptions.get("stream")));
    req = new LinkedHashMap<>(req);
    req.put("model", selectedModel);
    req.put("model_config", mergedConfig);
    lastUsedChatModel = selectedModel;
    lastUsedModelConfig = new LinkedHashMap<>(mergedConfig);
    return doChat(req, mergedOptions);
  }

  public Map<String, Object> embed(Map<String, Object> request) throws Exception {
    Object texts = request.get("texts");
    if (!(texts instanceof java.util.List<?> list) || list.isEmpty()) throw new AxAIServiceResponseError("Embed texts is empty");
    Object modelValue = request.getOrDefault("embed_model", request.get("embedModel"));
    String selected = modelValue == null ? embedModel : String.valueOf(modelValue);
    if (selected == null || selected.isBlank()) throw new AxAIServiceResponseError("Embed model not set");
    Map<String, Object> req = new LinkedHashMap<>(request);
    req.put("embed_model", selected);
    lastUsedEmbedModel = selected;
    return doEmbed(req, options);
  }

  public Map<String, Object> complete(Map<String, Object> request) throws Exception {
    return Core.asMap(Core.chat_response_to_completion(chat(Core.coerceChatRequest(request))));
  }

  protected abstract Map<String, Object> doChat(Map<String, Object> request, Map<String, Object> options) throws Exception;
  protected abstract Map<String, Object> doEmbed(Map<String, Object> request, Map<String, Object> options) throws Exception;
}
`

const javaAxAIServiceError = `package dev.ax;

public class AxAIServiceError extends RuntimeException {
  public final Integer status;
  public final String code;
  public final Object responseBody;
  public final Object request;
  public final boolean retryable;

  public AxAIServiceError(String message) { this(message, null, null, null, null, false); }
  public AxAIServiceError(String message, Integer status, String code, Object responseBody, Object request, boolean retryable) {
    super(message);
    this.status = status;
    this.code = code;
    this.responseBody = responseBody;
    this.request = request;
    this.retryable = retryable;
  }
}

class AxAIServiceStatusError extends AxAIServiceError {
  AxAIServiceStatusError(String message, Integer status, String code, Object responseBody, Object request, boolean retryable) { super(message, status, code, responseBody, request, retryable); }
}
class AxAIServiceNetworkError extends AxAIServiceError { AxAIServiceNetworkError(String message) { super(message); } }
class AxAIServiceResponseError extends AxAIServiceError {
  AxAIServiceResponseError(String message) { super(message); }
  AxAIServiceResponseError(String message, Object responseBody) { super(message, null, null, responseBody, null, false); }
}
class AxAIServiceStreamTerminatedError extends AxAIServiceError {
  AxAIServiceStreamTerminatedError(String message, Object responseBody, boolean retryable) { super(message, null, null, responseBody, null, retryable); }
}
class AxAIServiceTimeoutError extends AxAIServiceError {
  AxAIServiceTimeoutError(String message, Integer status, String code, Object responseBody, Object request, boolean retryable) { super(message, status, code, responseBody, request, retryable); }
}
class AxAIServiceAuthenticationError extends AxAIServiceError {
  AxAIServiceAuthenticationError(String message, Integer status, String code, Object responseBody, Object request) { super(message, status, code, responseBody, request, false); }
}
class AxAIRefusalError extends AxAIServiceError { AxAIRefusalError(String message, Object responseBody) { super(message, null, null, responseBody, null, false); } }
class AxUnsupportedCapabilityError extends AxAIServiceError { AxUnsupportedCapabilityError(String message) { super(message); } }
`

const javaAxMemory = `package dev.ax;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class AxMemory {
  private final List<Map<String, Object>> items = new ArrayList<>();

  public AxMemory addRequest(Object messages) {
    Map<String, Object> item = new LinkedHashMap<>();
    item.put("role", "request");
    item.put("messages", messages);
    item.put("tags", new ArrayList<>());
    items.add(item);
    return this;
  }

  public AxMemory addResponse(Object response) {
    Map<String, Object> item = new LinkedHashMap<>();
    item.put("role", "assistant");
    item.put("response", response);
    item.put("tags", new ArrayList<>());
    items.add(item);
    return this;
  }

  public AxMemory updateResult(Object response) {
    for (int i = items.size() - 1; i >= 0; i--) {
      if ("assistant".equals(items.get(i).get("role"))) {
        items.get(i).put("response", response);
        return this;
      }
    }
    return addResponse(response);
  }

  public AxMemory addFunctionResults(Object results) {
    Map<String, Object> item = new LinkedHashMap<>();
    item.put("role", "function");
    item.put("results", results instanceof List<?> ? results : List.of(results));
    item.put("tags", new ArrayList<>());
    items.add(item);
    return this;
  }

  public AxMemory addProcessorOutput(Object output) {
    Map<String, Object> item = new LinkedHashMap<>();
    item.put("role", "processor");
    item.put("output", output);
    item.put("tags", List.of("processor"));
    items.add(item);
    return this;
  }

  public AxMemory addCorrection(Object response, Object errorMessage) {
    Map<String, Object> item = new LinkedHashMap<>();
    item.put("role", "user");
    item.put("content", "Correction: " + errorMessage);
    item.put("response", response);
    item.put("tags", List.of("correction"));
    items.add(item);
    return this;
  }

  public List<Map<String, Object>> history() {
    return new ArrayList<>(items);
  }

  public Map<String, Object> getLast() {
    return items.isEmpty() ? null : items.get(items.size() - 1);
  }

  @SuppressWarnings("unchecked")
  public AxMemory addTag(String tag) {
    if (!items.isEmpty()) {
      List<String> tags = (List<String>) items.get(items.size() - 1).computeIfAbsent("tags", ignored -> new ArrayList<String>());
      if (!tags.contains(tag)) tags.add(tag);
    }
    return this;
  }

  public AxMemory rewindToTag(String tag) {
    for (int i = items.size() - 1; i >= 0; i--) {
      if (Core.asList(items.get(i).get("tags")).contains(tag)) {
        items.subList(i + 1, items.size()).clear();
        return this;
      }
    }
    return this;
  }

  public AxMemory removeByTag(String tag) {
    items.removeIf(item -> Core.asList(item.get("tags")).contains(tag));
    return this;
  }
}
`

const javaOpenAI = `package dev.ax;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class OpenAICompatibleClient extends AxBaseAI {
  public interface Transport {
    Object call(Map<String, Object> request) throws Exception;
  }

  private final String baseUrl;
  private final String apiKey;
  private final double timeoutSeconds;
  private final Transport transport;
  private final HttpClient http = HttpClient.newHttpClient();

  public OpenAICompatibleClient(String model) {
    this(Map.of("model", model));
  }

  public OpenAICompatibleClient(Map<String, Object> options) {
    super(
      "openai",
      String.valueOf(options.getOrDefault("model", "gpt-4.1-mini")),
      String.valueOf(options.getOrDefault("embed_model", options.getOrDefault("embedModel", "text-embedding-3-small"))),
      Core.asMap(options.get("model_config")),
      Core.asMap(options.get("options"))
    );
    this.baseUrl = String.valueOf(options.getOrDefault("base_url", options.getOrDefault("baseUrl", System.getenv().getOrDefault("OPENAI_BASE_URL", "https://api.openai.com/v1")))).replaceAll("/+$", "");
    this.apiKey = String.valueOf(options.getOrDefault("api_key", options.getOrDefault("apiKey", System.getenv("OPENAI_API_KEY"))));
    Object timeout = options.getOrDefault("timeout", 60.0);
    this.timeoutSeconds = timeout instanceof Number n ? n.doubleValue() : 60.0;
    this.transport = options.get("transport") instanceof Transport t ? t : null;
  }

  protected Map<String, Object> doChat(Map<String, Object> request, Map<String, Object> options) throws Exception {
    Map<String, Object> payload = Core.asMap(Core.openai_build_chat_request(request));
    Object stream = payload.get("stream");
    if (Boolean.TRUE.equals(stream)) {
      List<Map<String, Object>> out = new ArrayList<>();
      Map<String, Object> state = new LinkedHashMap<>();
      for (Object event : iterSseJson(requestJson("/chat/completions", payload, true))) {
        out.add(Core.asMap(Core.openai_normalize_stream_delta(event, state, name, payload.get("model"))));
      }
      return Map.of("results", out);
    }
    Object raw = requestJson("/chat/completions", payload, false);
    return Core.asMap(Core.openai_normalize_chat_response(raw, name, payload.get("model")));
  }

  protected Map<String, Object> doEmbed(Map<String, Object> request, Map<String, Object> options) throws Exception {
    Map<String, Object> payload = Core.asMap(Core.openai_build_embed_request(request));
    Object raw = requestJson("/embeddings", payload, false);
    return Core.asMap(Core.openai_normalize_embed_response(raw, name, payload.get("model")));
  }

  public Iterable<Map<String, Object>> stream(Map<String, Object> request) throws Exception {
    Map<String, Object> req = Core.coerceChatRequest(request);
    Core.validate_chat_request(req);
    Map<String, Object> modelConfig = Core.asMap(Core.merge_model_config(modelConfig(), req.get("model_config"), Map.of("stream", true)));
    modelConfig.put("stream", true);
    req.put("model", req.getOrDefault("model", model));
    req.put("model_config", modelConfig);
    Map<String, Object> payload = Core.asMap(Core.openai_build_chat_request(req));
    Object raw = requestJson("/chat/completions", payload, true);
    Map<String, Object> state = new LinkedHashMap<>();
    List<Map<String, Object>> out = new ArrayList<>();
    for (Object event : iterSseJson(raw)) out.add(Core.asMap(Core.openai_normalize_stream_delta(event, state, name, payload.get("model"))));
    return out;
  }

  private Map<String, Object> modelConfig() {
    return new LinkedHashMap<>(this.modelConfig);
  }

  private Object requestJson(String endpoint, Map<String, Object> payload, boolean stream) throws Exception {
    Map<String, Object> call = new LinkedHashMap<>();
    call.put("method", "POST");
    call.put("url", baseUrl + endpoint);
    call.put("headers", headers());
    call.put("json", payload);
    call.put("stream", stream);
    if (transport != null) return transportResult(transport.call(call), call);
    if (apiKey == null || apiKey.isBlank() || "null".equals(apiKey)) throw new AxAIServiceAuthenticationError("OPENAI_API_KEY is required", null, null, null, call);
    HttpRequest req = HttpRequest.newBuilder()
      .uri(URI.create(baseUrl + endpoint))
      .timeout(Duration.ofMillis((long) (timeoutSeconds * 1000)))
      .header("Authorization", "Bearer " + apiKey)
      .header("Content-Type", "application/json")
      .POST(HttpRequest.BodyPublishers.ofString(Json.stringify(payload)))
      .build();
    HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
    Object body;
    try { body = Json.parse(res.body()); } catch (RuntimeException ex) { body = res.body(); }
    if (res.statusCode() >= 400) throw Core.asRuntime(Core.openai_normalize_error(res.statusCode(), body, call));
    return body;
  }

  private Map<String, Object> headers() {
    return Map.of("Authorization", "Bearer " + (apiKey == null ? "" : apiKey), "Content-Type", "application/json");
  }

  private Object transportResult(Object result, Map<String, Object> request) {
    if (result instanceof Map<?, ?> raw) {
      Map<String, Object> map = Core.asMap(raw);
      if (map.containsKey("status")) {
        int status = Core.asInt(map.getOrDefault("status", 200));
        Object body = map.containsKey("json") ? map.get("json") : map.containsKey("body") ? map.get("body") : map.get("data");
        if (status >= 400) throw Core.asRuntime(Core.openai_normalize_error(status, body, request));
        return body;
      }
    }
    return result;
  }

  private Iterable<Object> iterSseJson(Object raw) {
    if (raw instanceof Iterable<?> items) {
      List<Object> out = new ArrayList<>();
      for (Object item : items) if (!"[DONE]".equals(item)) out.add(item);
      return out;
    }
    List<Object> out = new ArrayList<>();
    for (String line : String.valueOf(raw).split("\\R")) {
      line = line.trim();
      if (!line.startsWith("data:")) continue;
      String data = line.substring(5).trim();
      if (data.isBlank() || "[DONE]".equals(data)) continue;
      out.add(Json.parse(data));
    }
    return out;
  }
}
`

const javaAxGen = `package dev.ax;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class AxGen implements AxProgram {
  public interface AssertionCallback { Object apply(Map<String, Object> output); }
  public interface FieldProcessorCallback { Object apply(Object value); }
  public interface FunctionCallHook { void accept(Map<String, Object> record); }

  final AxSignature signature;
  final Map<String, Object> options;
  final List<Tool> functions;
  final PromptTemplate promptTemplate;
  final List<Map<String, Object>> examples;
  final List<Map<String, Object>> demos;
  final List<Object> assertions;
  final List<Map<String, Object>> fieldProcessors;
  final List<String> stopFunctions;
  final AxMemory memory;
  final List<Map<String, Object>> chatLog;
  final List<Map<String, Object>> functionCallTraces;
  final List<Map<String, Object>> traces;
  final String programId;
  String instruction;

  public AxGen(AxSignature signature) {
    this(signature, java.util.Map.of());
  }

  @SuppressWarnings("unchecked")
  public AxGen(AxSignature signature, Map<String, Object> options) {
    this.signature = signature;
    this.options = options == null ? new LinkedHashMap<>() : new LinkedHashMap<>(options);
    Object funcs = this.options.get("functions");
    this.functions = funcs instanceof List<?> list ? new ArrayList<>((List<Tool>) list) : new ArrayList<>();
    this.examples = new ArrayList<>();
    for (Object item : Core.asList(this.options.getOrDefault("examples", List.of()))) this.examples.add(Core.asMap(item));
    this.demos = new ArrayList<>();
    for (Object item : Core.asList(this.options.getOrDefault("demos", List.of()))) this.demos.add(Core.asMap(item));
    this.assertions = new ArrayList<>(Core.asList(this.options.getOrDefault("assertions", List.of())));
    this.fieldProcessors = new ArrayList<>();
    for (Object item : Core.asList(this.options.getOrDefault("field_processors", this.options.getOrDefault("fieldProcessors", List.of())))) this.fieldProcessors.add(Core.asMap(item));
    this.stopFunctions = new ArrayList<>();
    for (Object item : Core.asList(this.options.getOrDefault("stop_functions", this.options.getOrDefault("stopFunctions", List.of())))) this.stopFunctions.add(String.valueOf(item));
    this.memory = this.options.get("memory") instanceof AxMemory mem ? mem : new AxMemory();
    this.chatLog = new ArrayList<>();
    this.functionCallTraces = new ArrayList<>();
    this.traces = new ArrayList<>();
    this.programId = String.valueOf(this.options.getOrDefault("id", this.options.getOrDefault("program_id", this.options.getOrDefault("programId", "root"))));
    this.instruction = String.valueOf(this.options.getOrDefault("instruction", ""));
    this.promptTemplate = new PromptTemplate(
      signature,
      functions,
      (String) this.options.getOrDefault("structured_output_function_name", this.options.get("structuredOutputFunctionName")),
      (String) this.options.getOrDefault("custom_template", this.options.get("customTemplate"))
    );
  }

  public AxGen addTool(Tool tool) {
    functions.add(tool);
    return this;
  }

  public AxGen setExamples(List<Map<String, Object>> examples) {
    this.examples.clear();
    if (examples != null) this.examples.addAll(examples);
    return this;
  }

  public AxGen setDemos(List<Map<String, Object>> demos) {
    this.demos.clear();
    if (demos != null) this.demos.addAll(demos);
    return this;
  }

  public AxGen addAssertion(Map<String, Object> assertion) {
    this.assertions.add(assertion);
    return this;
  }

  public AxGen addAssertion(AssertionCallback assertion) {
    this.assertions.add(assertion);
    return this;
  }

  public AxGen addFieldProcessor(String field, String op) {
    this.fieldProcessors.add(new java.util.LinkedHashMap<>(Map.of("field", field, "processor", op)));
    return this;
  }

  public AxGen addFieldProcessor(String field, FieldProcessorCallback processor) {
    Map<String, Object> spec = new LinkedHashMap<>();
    spec.put("field", field);
    spec.put("processor", processor);
    this.fieldProcessors.add(spec);
    return this;
  }

  public AxGen onFunctionCall(FunctionCallHook hook) {
    if (hook != null) this.options.put("onFunctionCall", hook);
    return this;
  }

  public AxGen setStopFunctions(List<String> names) {
    this.stopFunctions.clear();
    if (names != null) this.stopFunctions.addAll(names);
    return this;
  }

  public AxGen setInstruction(String instruction) {
    this.instruction = instruction == null ? "" : instruction;
    this.options.put("instruction", this.instruction);
    this.promptTemplate.setInstruction(this.instruction);
    return this;
  }

  public String getInstruction() {
    return instruction;
  }

  public AxGen clearInstruction() {
    return setInstruction("");
  }

  public List<Map<String, Object>> getOptimizableComponents() {
    List<Map<String, Object>> components = new ArrayList<>();
    if (signature.description != null && !signature.description.isBlank()) {
      components.add(Core.asMap(Core._optimization_component(
        programId + "::description",
        programId,
        "description",
        signature.description,
        "Program signature description.",
        List.of("Preserve the task intent and field references."),
        List.of(),
        false,
        "markdown",
        Map.of("required_placeholders", List.of())
      )));
    }
    components.add(Core.asMap(Core._optimization_component(
      programId + "::instruction",
      programId,
      "instruction",
      instruction,
      "Prompt instruction text used by this generator.",
      List.of("Keep required input and output fields intact."),
      List.of(),
      false,
      "markdown",
      Map.of("required_placeholders", List.of())
    )));
    for (Tool tool : functions) {
      components.add(Core.asMap(Core._optimization_component(
        programId + "::fn:" + tool.name + ":desc",
        programId,
        "fn-desc",
        tool.description,
        "Description for tool " + tool.name + ".",
        List.of("Non-empty, concise, and faithful to the tool behavior."),
        List.of(),
        false,
        "text",
        Map.of("maxLength", 320)
      )));
      components.add(Core.asMap(Core._optimization_component(
        programId + "::fn:" + tool.name + ":name",
        programId,
        "fn-name",
        tool.name,
        "Callable name for tool " + tool.name + ".",
        List.of("snake_case", "32 characters or fewer", "unique among tools"),
        List.of(),
        true,
        "snake_case",
        Map.of("pattern", "^[a-z][a-z0-9_]{0,31}$")
      )));
    }
    return components;
  }

  public AxGen applyOptimizedComponents(Map<String, Object> componentMap) {
    Map<String, Object> updates = componentMap == null ? Map.of() : componentMap;
    if (updates.containsKey(programId + "::description")) this.options.put("optimized_description", String.valueOf(updates.get(programId + "::description")));
    if (updates.containsKey(programId + "::instruction")) setInstruction(String.valueOf(updates.get(programId + "::instruction")));
    for (int i = 0; i < functions.size(); i++) {
      Tool tool = functions.get(i);
      String desc = updates.containsKey(programId + "::fn:" + tool.name + ":desc") ? String.valueOf(updates.get(programId + "::fn:" + tool.name + ":desc")) : tool.description;
      String name = updates.containsKey(programId + "::fn:" + tool.name + ":name") ? String.valueOf(updates.get(programId + "::fn:" + tool.name + ":name")).trim() : tool.name;
      if (!name.matches("^[a-z][a-z0-9_]{0,31}$")) throw new RuntimeException("invalid optimized function name: " + name);
      for (Tool other : functions) if (other != tool && other.name.equals(name)) throw new RuntimeException("duplicate optimized function name: " + name);
      if (!desc.equals(tool.description) || !name.equals(tool.name)) functions.set(i, new Tool(name, desc, tool.args, tool.returns, tool.handler));
    }
    return this;
  }

  @SuppressWarnings("unchecked")
  public AxGen applyOptimization(Object artifact) {
    List<Map<String, Object>> components = getOptimizableComponents();
    Map<String, Object> map = artifact instanceof String text
      ? Core.asMap(Core._deserialize_optimized_artifact(text, components))
      : Core.asMap(Core._validate_optimized_artifact(artifact == null ? Map.of() : artifact, components));
    return applyOptimizedComponents((Map<String, Object>) map.getOrDefault("componentMap", Map.of()));
  }

  public Map<String, Object> evaluateOptimization(AiClient client, Object dataset, Map<String, Object> candidateMap, Map<String, Object> options) {
    Map<String, Object> opts = options == null ? Map.of() : options;
    Map<String, Object> normalized = Core.asMap(Core._normalize_optimization_dataset(dataset == null ? List.of() : dataset));
    List<Object> rows = new ArrayList<>();
    Map<String, Object> original = Core.asMap(Core._optimization_component_current_map(getOptimizableComponents()));
    Map<String, Object> candidate = candidateMap == null ? Map.of() : candidateMap;
    try {
      if (!candidate.isEmpty()) applyOptimizedComponents(candidate);
      for (Object rawTask : Core.asList(normalized.getOrDefault("train", List.of()))) {
        Map<String, Object> task = Core.asMap(rawTask);
        Object error = null;
        Map<String, Object> prediction;
        try {
          Object output = forward(client, Core.asMap(task.getOrDefault("input", task)), Core.asMap(opts.getOrDefault("forward_options", Map.of())));
          prediction = new LinkedHashMap<>();
          prediction.put("completionType", "final");
          prediction.put("output", output);
          prediction.put("finalOutput", output);
          prediction.put("functionCalls", getFunctionCallTraces());
          prediction.put("actionLog", getChatLog());
          prediction.put("usage", Map.of());
          prediction.put("trace", Map.of("traces", getTraces()));
        } catch (RuntimeException e) {
          error = Map.of("message", String.valueOf(e.getMessage()));
          prediction = new LinkedHashMap<>();
          prediction.put("completionType", "error");
          prediction.put("error", error);
          prediction.put("functionCalls", getFunctionCallTraces());
          prediction.put("actionLog", getChatLog());
          prediction.put("usage", Map.of());
          prediction.put("trace", Map.of("traces", getTraces()));
        }
        Map<String, Object> scores = Core.asMap(Core._normalize_optimization_metric_scores(task.containsKey("metric_score") ? task.get("metric_score") : task.containsKey("scores") ? task.get("scores") : task.getOrDefault("score", "error".equals(prediction.get("completionType")) ? 0 : 1)));
        Object scalar = Core._adjust_optimization_score_for_actions(Core._scalarize_optimization_scores(scores, opts), task, prediction);
        rows.add(Core._build_optimization_eval_row(task, prediction, scores, scalar, prediction.get("trace"), error));
      }
      return Core.asMap(Core._build_optimization_eval_result(rows, candidate, opts.getOrDefault("phase", "train")));
    } finally {
      applyOptimizedComponents(original);
    }
  }

  public Map<String, Object> optimizeWith(OptimizerEngine engine, List<Map<String, Object>> dataset, Map<String, Object> options) {
    Map<String, Object> opts = options == null ? Map.of() : options;
    List<Map<String, Object>> components = getOptimizableComponents();
    Object client = opts.getOrDefault("client", opts.get("ai"));
    Map<String, Object> run = Core.asMap(Core._prepare_optimizer_run("axgen", components, dataset == null ? List.of() : dataset, opts, Map.of("traces", getTraces(), "chat_log", getChatLog()), client instanceof AiClient));
    Map<String, Object> request = Core.asMap(run.getOrDefault("request", Map.of()));
    OptimizerEvaluator evaluator = client instanceof AiClient aiClient
      ? (candidate, evalOptions) -> evaluateOptimization(aiClient, dataset == null ? List.of() : dataset, candidate, Core.asMap(evalOptions == null ? Map.of() : evalOptions))
      : null;
    Map<String, Object> response = engine.optimize(request, evaluator);
    Map<String, Object> artifact = Core.asMap(Core._normalize_optimizer_engine_response(response, engine.name(), engine.version(), components));
    if (!Boolean.FALSE.equals(opts.get("apply"))) applyOptimization(artifact);
    return artifact;
  }

  public Map<String, Object> optimize(List<Map<String, Object>> dataset, Map<String, Object> options) {
    Object engine = options == null ? null : options.getOrDefault("engine", options.get("optimizer"));
    if (!(engine instanceof OptimizerEngine optimizer)) throw new UnsupportedOperationException("AxIR generated runtimes require an OptimizerEngine for optimize()");
    return optimizeWith(optimizer, dataset, options);
  }

  public List<Map<String, Object>> getTraces() {
    return new ArrayList<>(traces);
  }

  public List<Map<String, Object>> getChatLog() {
    return new ArrayList<>(chatLog);
  }

  public List<Map<String, Object>> getFunctionCallTraces() {
    return new ArrayList<>(functionCallTraces);
  }

  public AxMemory getMemory() {
    return memory;
  }

  public Map<String, Object> forward(AiClient client, Map<String, Object> values) {
    return forward(client, values, java.util.Map.of());
  }

  public Map<String, Object> forward(AiClient client, Map<String, Object> values, Map<String, Object> forwardOptions) {
    return Core.asMap(Core._forward_impl(this, client, values, forwardOptions == null ? java.util.Map.of() : forwardOptions));
  }

  Map<String, Object> request(List<Map<String, Object>> messages, Map<String, Object> opts) {
    return Core.asMap(Core._build_gen_chat_request(this, messages, opts == null ? java.util.Map.of() : opts));
  }
}
`

const javaAxFlow = `package dev.ax;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class AxFlow implements AxProgram {
  public interface Mapper {
    Object apply(Map<String, Object> state);
  }

  final Map<String, Object> state;

  public AxFlow() {
    this(Map.of());
  }

  public AxFlow(Map<String, Object> options) {
    this.state = Core.asMap(Core._flow_factory(options == null ? Map.of() : options));
  }

  public AxFlow execute(String name, AxProgram program) {
    return execute(name, program, Map.of());
  }

  public AxFlow execute(String name, AxProgram program, Map<String, Object> options) {
    return addStep("execute", name, program, options);
  }

  public AxFlow derive(String name, AxProgram program) {
    return derive(name, program, Map.of());
  }

  public AxFlow derive(String name, AxProgram program, Map<String, Object> options) {
    return addStep("derive", name, program, options);
  }

  public AxFlow map(String name, Mapper mapper) {
    return addStep("map", name, mapper, Map.of());
  }

  public AxFlow map(String name, Mapper mapper, Map<String, Object> options) {
    return addStep("map", name, mapper, options == null ? Map.of() : options);
  }

  public AxFlow parallel(List<Map<String, Object>> steps) {
    for (Map<String, Object> step : steps == null ? List.<Map<String, Object>>of() : steps) {
      addStep(String.valueOf(step.getOrDefault("kind", "execute")), String.valueOf(step.get("name")), step.get("program"), Core.asMap(step.getOrDefault("options", Map.of())));
    }
    return this;
  }

  public AxFlow returns(Map<String, Object> spec) {
    Core._flow_set_returns(state, spec == null ? Map.of() : spec);
    return this;
  }

  public AxFlow setDemos(Object demos) {
    if (demos instanceof Map<?, ?>) return setDemos(Core.asMap(demos));
    List<Object> demoList = Core.asList(demos);
    if (!demoList.isEmpty()) {
      String owner = String.valueOf(state.getOrDefault("program_id", "root.flow"));
      java.util.Set<String> knownIds = new java.util.LinkedHashSet<>();
      knownIds.add(owner);
      knownIds.add("root");
      for (Object raw : Core.asList(state.getOrDefault("steps", List.of()))) {
        String name = String.valueOf(Core.asMap(raw).getOrDefault("name", ""));
        if (!name.isBlank()) {
          knownIds.add(owner + "." + name);
          knownIds.add("root." + name);
        }
      }
      java.util.Set<String> unknown = new java.util.TreeSet<>();
      for (Object raw : demoList) {
        Object id = Core.asMap(raw).get("programId");
        if (id != null && !knownIds.contains(String.valueOf(id))) unknown.add(String.valueOf(id));
      }
      if (!unknown.isEmpty()) throw new RuntimeException("Unknown program ID(s) in demos: " + String.join(", ", unknown));
      state.put("demos", new ArrayList<>(demoList));
    }
    return this;
  }

  public AxFlow setDemos(Map<String, Object> demos) {
    Map<String, Object> demoMap = demos == null ? Map.of() : demos;
    List<Object> steps = Core.asList(state.getOrDefault("steps", List.of()));
    for (String name : demoMap.keySet()) {
      boolean found = false;
      for (Object raw : steps) {
        Map<String, Object> step = Core.asMap(raw);
        if (name.equals(step.get("name"))) {
          found = true;
          Object program = step.get("program");
          if (program instanceof AxGen gen) gen.setDemos(Core.asMapList(demoMap.get(name)));
        }
      }
      if (!found) throw new RuntimeException("unknown flow node in demos: " + name);
    }
    state.put("demos", new LinkedHashMap<>(demoMap));
    return this;
  }

  public Map<String, Object> getPlan() {
    return Core.asMap(Core._flow_plan(state));
  }

  public List<Map<String, Object>> getTraces() {
    return Core.asMapList(state.getOrDefault("traces", List.of()));
  }

  public List<Map<String, Object>> getChatLog() {
    return Core.asMapList(state.getOrDefault("chat_log", List.of()));
  }

  public Map<String, Object> getUsage() {
    return Core.asMap(state.getOrDefault("usage", Map.of()));
  }

  public List<Map<String, Object>> getOptimizableComponents() {
    return Core.asMapList(Core._flow_get_optimizable_components(state));
  }

  public AxFlow applyOptimizedComponents(Map<String, Object> componentMap) {
    Core._flow_apply_optimized_components(state, componentMap == null ? Map.of() : componentMap);
    return this;
  }

  public AxFlow applyOptimization(Object artifact) {
    List<Map<String, Object>> components = getOptimizableComponents();
    Map<String, Object> map = artifact instanceof String text
      ? Core.asMap(Core._deserialize_optimized_artifact(text, components))
      : Core.asMap(Core._validate_optimized_artifact(artifact == null ? Map.of() : artifact, components));
    return applyOptimizedComponents(Core.asMap(map.getOrDefault("componentMap", Map.of())));
  }

  public Map<String, Object> evaluateOptimization(AiClient client, Object dataset, Map<String, Object> candidateMap, Map<String, Object> options) {
    return Core.asMap(Core._flow_evaluate_optimization(state, client, dataset == null ? List.of() : dataset, candidateMap == null ? Map.of() : candidateMap, options == null ? Map.of() : options));
  }

  public Map<String, Object> optimizeWith(OptimizerEngine engine, List<Map<String, Object>> dataset, Map<String, Object> options) {
    Map<String, Object> opts = options == null ? Map.of() : options;
    Object client = opts.getOrDefault("client", opts.get("ai"));
    Map<String, Object> request = Core.asMap(Core._flow_optimize_with(state, dataset == null ? List.of() : dataset, opts, client instanceof AiClient));
    OptimizerEvaluator evaluator = null;
    if (client instanceof AiClient aiClient) {
      evaluator = (candidateMap, evalOptions) -> evaluateOptimization(aiClient, dataset == null ? List.of() : dataset, candidateMap, Core.asMap(Core.mapMerge(opts, evalOptions == null ? Map.of() : evalOptions)));
    }
    Map<String, Object> response = evaluator == null ? engine.optimize(request) : engine.optimize(request, evaluator);
    Map<String, Object> artifact = Core.asMap(Core._normalize_optimizer_engine_response(response, engine.name(), engine.version(), getOptimizableComponents()));
    if (!Boolean.FALSE.equals(opts.getOrDefault("apply", Boolean.TRUE))) applyOptimization(artifact);
    return artifact;
  }

  public Map<String, Object> optimize(List<Map<String, Object>> dataset, Map<String, Object> options) {
    Object engine = options == null ? null : options.getOrDefault("engine", options.get("optimizer"));
    if (!(engine instanceof OptimizerEngine optimizer)) throw new UnsupportedOperationException("AxIR generated runtimes require an OptimizerEngine for optimize()");
    return optimizeWith(optimizer, dataset, options);
  }

  public Map<String, Object> forward(AiClient client, Map<String, Object> values) {
    return forward(client, values, Map.of());
  }

  public Map<String, Object> forward(AiClient client, Map<String, Object> values, Map<String, Object> options) {
    return Core.asMap(Core._flow_forward(state, client, values == null ? Map.of() : values, options == null ? Map.of() : options));
  }

  private AxFlow addStep(String kind, String name, Object program, Map<String, Object> options) {
    Core._flow_add_step(state, Core._flow_step(kind, name, program, options == null ? Map.of() : options));
    return this;
  }
}
`

const javaOptimizerEngine = `package dev.ax;

import java.util.Map;

public interface OptimizerEngine {
  default String name() { return "host"; }
  default String version() { return "host"; }
  Map<String, Object> optimize(Map<String, Object> request);
  default Map<String, Object> optimize(Map<String, Object> request, OptimizerEvaluator evaluator) {
    return optimize(request);
  }
}
`

const javaOptimizerEvaluator = `package dev.ax;

import java.util.Map;

public interface OptimizerEvaluator {
  Map<String, Object> evaluate(Map<String, Object> candidateMap, Map<String, Object> options);
}
`

const javaAxAgentClarificationException = `package dev.ax;

public final class AxAgentClarificationException extends RuntimeException {
  private final Object clarification;
  private final Object state;
  private final Object payload;

  public AxAgentClarificationException(Object clarification, Object state, Object payload) {
    super(String.valueOf(Core.get(clarification, "question", Core.get(clarification, "message", clarification))));
    this.clarification = clarification;
    this.state = state;
    this.payload = payload;
  }

  public Object clarification() { return clarification; }
  public Object state() { return state; }
  public Object payload() { return payload; }
}
`

const javaAxCodeRuntime = `package dev.ax;

import java.util.Map;

public interface AxCodeRuntime {
  default String language() { return "JavaScript"; }
  default String getUsageInstructions() { return ""; }
  AxCodeSession createSession(Map<String, Object> globals, Map<String, Object> options);
}
`

const javaAxCodeSession = `package dev.ax;

import java.util.Map;

public interface AxCodeSession {
  Object execute(String code, Map<String, Object> options);
  Object inspectGlobals(Map<String, Object> options);
  Object exportState(Map<String, Object> options);
  Object restoreState(Object snapshot, Map<String, Object> options);
  Object close();
}
`

const javaAxAgent = `package dev.ax;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class AxAgent implements AxProgram {
  final Map<String, Object> options;
  final Map<String, Object> state;
  final Object signature;
  final AxGen distiller;
  final AxGen executor;
  final AxGen responder;

  public AxAgent(String signature, Map<String, Object> options) {
    this((Object) signature, options);
  }

  @SuppressWarnings("unchecked")
  public AxAgent(Object signature, Map<String, Object> options) {
    this.options = options == null ? new LinkedHashMap<>() : new LinkedHashMap<>(options);
    this.state = Core.asMap(Core._agent_factory(signature, this.options));
    this.signature = Core.get(state, "signature", signature);
    this.distiller = new AxGen(AxSignature.create(String.valueOf(Core.get(state, "distiller_signature", "input:json -> completion:json"))), Map.of("validation_retries", 0, "id", "ctx.root.actor"));
    this.executor = new AxGen(AxSignature.create(String.valueOf(Core.get(state, "executor_signature", "input:json -> completion:json"))), Map.of("validation_retries", 0, "id", "task.root.actor"));
    this.responder = new AxGen((AxSignature) this.signature, Map.of("validation_retries", this.options.getOrDefault("validation_retries", 2), "id", "task.root.responder"));
  }

  public Map<String, Object> forward(AiClient client, Map<String, Object> values) {
    return forward(client, values, Map.of());
  }

  public Map<String, Object> forward(AiClient client, Map<String, Object> values, Map<String, Object> forwardOptions) {
    return Core.asMap(Core._agent_forward(
      state,
      distiller,
      executor,
      responder,
      client,
      values == null ? Map.of() : values,
      forwardOptions == null ? Map.of() : forwardOptions
    ));
  }

  public Map<String, Object> test(AxCodeRuntime runtime, String code) {
    return test(runtime, code, Map.of(), Map.of());
  }

  public Map<String, Object> test(AxCodeRuntime runtime, String code, Map<String, Object> contextFieldValues) {
    return test(runtime, code, contextFieldValues, Map.of());
  }

  public Map<String, Object> test(AxCodeRuntime runtime, String code, Map<String, Object> contextFieldValues, Map<String, Object> options) {
    return Core.asMap(Core._agent_runtime_test(
      state,
      runtime,
      code,
      contextFieldValues == null ? Map.of() : contextFieldValues,
      options == null ? Map.of() : options
    ));
  }

  public Map<String, Object> executeActorStep(AxCodeRuntime runtime, String code, Map<String, Object> values) {
    return executeActorStep(runtime, code, values, Map.of());
  }

  public Map<String, Object> executeActorStep(AxCodeRuntime runtime, String code, Map<String, Object> values, Map<String, Object> options) {
    Core._agent_runtime_build_globals(state, values == null ? Map.of() : values);
    Object session = Core.get(state, "runtime_session", null);
    return Core.asMap(Core._agent_runtime_execute_step(
      state,
      runtime,
      session,
      code,
      options == null ? Map.of() : options
    ));
  }

  public Object inspectRuntime() {
    return inspectRuntime(Map.of());
  }

  public Object inspectRuntime(Map<String, Object> options) {
    return Core._agent_runtime_inspect_state(state, Core.get(state, "runtime_session", null), options == null ? Map.of() : options);
  }

  public Object exportSessionState() {
    return exportSessionState(Map.of());
  }

  public Object exportSessionState(Map<String, Object> options) {
    return Core._agent_runtime_export_session_state(state, Core.get(state, "runtime_session", null), options == null ? Map.of() : options);
  }

  public Object restoreSessionState(Object snapshot) {
    return restoreSessionState(snapshot, Map.of());
  }

  public Object restoreSessionState(Object snapshot, Map<String, Object> options) {
    return Core._agent_runtime_restore_session_state(state, Core.get(state, "runtime_session", null), snapshot == null ? Map.of() : snapshot, options == null ? Map.of() : options);
  }

  public Object closeRuntimeSession() {
    return Core._agent_runtime_close_session(state, Core.get(state, "runtime_session", null));
  }

  public Map<String, Object> getState() {
    return Core.asMap(Core._agent_get_state(state));
  }

  public Object setState(Map<String, Object> newState) {
    return Core._agent_set_state(state, newState == null ? Map.of() : newState);
  }

  public List<Object> getChatLog() {
    return Core.asList(Core.get(state, "chat_log", List.of()));
  }

  public List<Object> getActionLog() {
    return Core.asList(Core.get(state, "action_log", List.of()));
  }

  public Map<String, Object> getTrace() {
    return Core.asMap(Core._agent_export_trace(state));
  }

  public Map<String, Object> exportTrace() {
    return Core.asMap(Core._agent_export_trace(state));
  }

  public Map<String, Object> replayTrace(Object trace, Map<String, Object> fixtures) {
    return Core.asMap(Core._agent_replay_trace(trace == null ? Map.of() : trace, fixtures == null ? Map.of() : fixtures));
  }

  public Map<String, Object> getUsage() {
    return Core.asMap(Core.get(state, "usage", Map.of()));
  }

  public Map<String, Object> getRuntimeContract() {
    return Core.asMap(Core.get(state, "runtime_contract", Map.of()));
  }

  public Map<String, Object> getPolicy() {
    return Core.asMap(Core.get(state, "policy", Map.of()));
  }

  public Map<String, Object> getPolicyRegistry() {
    return Core.asMap(Core.get(state, "policy_registry", Map.of()));
  }

  public List<Object> getCallableInventory() {
    return Core.asList(Core.get(state, "callable_inventory", List.of()));
  }

  public List<Object> getDiscoveryCatalog() {
    return Core.asList(Core.get(state, "discovery_catalog", List.of()));
  }

  public Object discover(Map<String, Object> request) {
    return Core._agent_discover(state, request == null ? Map.of() : request);
  }

  public Object recall(Object request) {
    return Core._agent_recall(state, request == null ? List.of() : request);
  }

  public Object used(String id) {
    return used(id, "", "executor");
  }

  public Object used(String id, String reason, String stage) {
    return Core._agent_used(state, new LinkedHashMap<>(Map.of("id", id, "reason", reason == null ? "" : reason, "stage", stage == null ? "executor" : stage)), stage == null ? "executor" : stage);
  }

  public Object invokeCallable(String qualifiedName, Map<String, Object> args) {
    Map<String, Object> request = new LinkedHashMap<>();
    request.put("qualified_name", qualifiedName);
    request.put("args", args == null ? Map.of() : args);
    return Core._agent_execute_callable(state, request, Map.of());
  }

  public Map<String, Object> exportRuntimeState() {
    return Core.asMap(Core._agent_export_runtime_state(state));
  }

  public Map<String, Object> restoreRuntimeState(Map<String, Object> snapshot) {
    return Core.asMap(Core._agent_restore_runtime_state(state, snapshot == null ? Map.of() : snapshot));
  }

  public Map<String, Object> getOptimizerMetadata() {
    return Core.asMap(Core._agent_optimizer_metadata(state));
  }

  public List<Map<String, Object>> getOptimizableComponents() {
    List<Map<String, Object>> components = new ArrayList<>();
    components.addAll(distiller.getOptimizableComponents());
    components.addAll(executor.getOptimizableComponents());
    components.addAll(responder.getOptimizableComponents());
    components.add(Core.asMap(Core._optimization_component(
      "root.agent.runtime",
      "root.agent",
      "runtime-policy",
      getRuntimeContract(),
      "Agent runtime-language metadata and code-field policy.",
      List.of("Keep code field names aligned with the selected runtime language."),
      List.of(),
      true,
      "json",
      Map.of("component", "runtime_contract")
    )));
    components.add(Core.asMap(Core._optimization_component(
      "root.agent.policy",
      "root.agent",
      "agent-policy",
      getPolicy(),
      "Actor primitive, discovery, delegation, and prompt placement policy.",
      List.of("Do not expose protocol-only actions as actor primitives."),
      List.of("root.agent.runtime"),
      true,
      "json",
      Map.of("component", "policy_registry")
    )));
    return components;
  }

  public AxAgent applyOptimizedComponents(Map<String, Object> componentMap) {
    Map<String, Object> updates = componentMap == null ? Map.of() : componentMap;
    Core._validate_optimization_component_map(getOptimizableComponents(), updates);
    distiller.applyOptimizedComponents(updates);
    executor.applyOptimizedComponents(updates);
    responder.applyOptimizedComponents(updates);
    if (updates.get("root.agent.runtime") instanceof Map<?, ?> runtime) state.put("runtime_contract", Core.asMap(runtime));
    if (updates.get("root.agent.policy") instanceof Map<?, ?> policy) state.put("policy", Core.asMap(policy));
    state.put("optimizer_metadata", Core._agent_optimizer_metadata(state));
    return this;
  }

  public AxAgent applyOptimization(Object artifact) {
    List<Map<String, Object>> components = getOptimizableComponents();
    Map<String, Object> map = artifact instanceof String text
      ? Core.asMap(Core._deserialize_optimized_artifact(text, components))
      : Core.asMap(Core._validate_optimized_artifact(artifact == null ? Map.of() : artifact, components));
    return applyOptimizedComponents(Core.asMap(map.getOrDefault("componentMap", Map.of())));
  }

  public Map<String, Object> evaluateOptimizationTask(AiClient client, Map<String, Object> task, Map<String, Object> options) {
    Map<String, Object> opts = options == null ? Map.of() : options;
    try {
      Map<String, Object> output = forward(client, Core.asMap(task.getOrDefault("input", task)), Core.asMap(opts.getOrDefault("forward_options", Map.of())));
      return Core.asMap(Core._build_agent_eval_prediction(output, getActionLog(), getUsage(), exportTrace()));
    } catch (AxAgentClarificationException e) {
      Map<String, Object> out = new LinkedHashMap<>();
      out.put("completionType", "askClarification");
      out.put("clarification", e.clarification());
      out.put("actionLog", getActionLog());
      out.put("functionCalls", Core.asList(state.getOrDefault("function_call_traces", List.of())));
      out.put("toolErrors", List.of());
      out.put("turnCount", 0);
      out.put("usage", getUsage());
      out.put("trace", exportTrace());
      return out;
    } catch (RuntimeException e) {
      Map<String, Object> out = new LinkedHashMap<>();
      out.put("completionType", "error");
      out.put("error", Map.of("message", String.valueOf(e.getMessage())));
      out.put("actionLog", getActionLog());
      out.put("functionCalls", Core.asList(state.getOrDefault("function_call_traces", List.of())));
      out.put("toolErrors", List.of(String.valueOf(e.getMessage())));
      out.put("turnCount", 0);
      out.put("usage", getUsage());
      out.put("trace", exportTrace());
      return out;
    }
  }

  public Map<String, Object> evaluateOptimization(AiClient client, Object dataset, Map<String, Object> candidateMap, Map<String, Object> options) {
    Map<String, Object> opts = options == null ? Map.of() : options;
    Map<String, Object> normalized = Core.asMap(Core._normalize_optimization_dataset(dataset == null ? List.of() : dataset));
    List<Object> rows = new ArrayList<>();
    Map<String, Object> original = Core.asMap(Core._optimization_component_current_map(getOptimizableComponents()));
    Map<String, Object> candidate = candidateMap == null ? Map.of() : candidateMap;
    int maxMetricCalls = ((Number) opts.getOrDefault("maxMetricCalls", opts.getOrDefault("max_metric_calls", Integer.MAX_VALUE))).intValue();
    int calls = 0;
    try {
      if (!candidate.isEmpty()) applyOptimizedComponents(candidate);
      for (Object rawTask : Core.asList(normalized.getOrDefault("train", List.of()))) {
        if (calls >= maxMetricCalls) throw new RuntimeException("max metric calls exceeded: " + maxMetricCalls);
        calls++;
        Map<String, Object> task = Core.asMap(rawTask);
        Map<String, Object> prediction = evaluateOptimizationTask(client, task, opts);
        Object error = prediction.get("error");
        Object rawScore = task.containsKey("metric_score") ? task.get("metric_score") : task.containsKey("scores") ? task.get("scores") : task.getOrDefault("score", "error".equals(prediction.get("completionType")) ? 0 : 1);
        Map<String, Object> scores = Core.asMap(Core._normalize_optimization_metric_scores(rawScore));
        Object scalar = Core._adjust_optimization_score_for_actions(Core._scalarize_optimization_scores(scores, opts), task, prediction);
        rows.add(Core._build_optimization_eval_row(task, prediction, scores, scalar, prediction.get("trace"), error));
      }
      return Core.asMap(Core._build_optimization_eval_result(rows, candidate, opts.getOrDefault("phase", "train")));
    } finally {
      applyOptimizedComponents(original);
    }
  }

  public Map<String, Object> optimizeWith(OptimizerEngine engine, List<Map<String, Object>> dataset, Map<String, Object> options) {
    Map<String, Object> opts = options == null ? Map.of() : options;
    List<Map<String, Object>> components = getOptimizableComponents();
    Object client = opts.getOrDefault("client", opts.get("ai"));
    Map<String, Object> run = Core.asMap(Core._prepare_optimizer_run("axagent", components, dataset == null ? List.of() : dataset, opts, exportTrace(), client instanceof AiClient));
    Map<String, Object> request = Core.asMap(run.getOrDefault("request", Map.of()));
    OptimizerEvaluator evaluator = client instanceof AiClient aiClient
      ? (candidate, evalOptions) -> evaluateOptimization(aiClient, dataset == null ? List.of() : dataset, candidate, Core.asMap(evalOptions == null ? Map.of() : evalOptions))
      : null;
    Map<String, Object> response = engine.optimize(request, evaluator);
    Map<String, Object> artifact = Core.asMap(Core._normalize_optimizer_engine_response(response, engine.name(), engine.version(), components));
    if (!Boolean.FALSE.equals(opts.get("apply"))) applyOptimization(artifact);
    return artifact;
  }

  public Map<String, Object> optimize(List<Map<String, Object>> dataset, Map<String, Object> options) {
    Object engine = options == null ? null : options.getOrDefault("engine", options.get("optimizer"));
    if (!(engine instanceof OptimizerEngine optimizer)) throw new UnsupportedOperationException("AxIR generated runtimes require an OptimizerEngine for optimize()");
    return optimizeWith(optimizer, dataset, options);
  }
}
`

const javaJson = `package dev.ax;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class Json {
  public static Object parse(String src) { return new Parser(src).parse(); }

  @SuppressWarnings("unchecked")
  public static Map<String, Object> asObject(Object value) {
    if (value == null) return new LinkedHashMap<>();
    if (value instanceof Map<?, ?> map) return (Map<String, Object>) map;
    throw new IllegalArgumentException("expected object");
  }

  @SuppressWarnings("unchecked")
  public static List<Object> asList(Object value) {
    if (value instanceof List<?> list) return (List<Object>) list;
    return new ArrayList<>();
  }

  public static String stringify(Object value) {
    if (value == null) return "null";
    if (value instanceof String s) return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n") + "\"";
    if (value instanceof Number || value instanceof Boolean) return String.valueOf(value);
    if (value instanceof Map<?, ?> map) {
      List<String> parts = new ArrayList<>();
      for (Map.Entry<?, ?> e : map.entrySet()) parts.add(stringify(String.valueOf(e.getKey())) + ":" + stringify(e.getValue()));
      return "{" + String.join(",", parts) + "}";
    }
    if (value instanceof Iterable<?> items) {
      List<String> parts = new ArrayList<>();
      for (Object item : items) parts.add(stringify(item));
      return "[" + String.join(",", parts) + "]";
    }
    return stringify(String.valueOf(value));
  }

  public static String stableStringify(Object value) {
    if (value == null) return "null";
    if (value instanceof String || value instanceof Number || value instanceof Boolean) return stringify(value);
    if (value instanceof Map<?, ?> map) {
      List<String> keys = new ArrayList<>();
      for (Object key : map.keySet()) keys.add(String.valueOf(key));
      java.util.Collections.sort(keys);
      List<String> parts = new ArrayList<>();
      for (String key : keys) parts.add(stringify(key) + ":" + stableStringify(map.get(key)));
      return "{" + String.join(",", parts) + "}";
    }
    if (value instanceof Iterable<?> items) {
      List<String> parts = new ArrayList<>();
      for (Object item : items) parts.add(stableStringify(item));
      return "[" + String.join(",", parts) + "]";
    }
    return stringify(String.valueOf(value));
  }

  public static String pretty(Object value) {
    return stringify(value);
  }

  private static final class Parser {
    private final String src;
    private int pos;
    Parser(String src) { this.src = src == null ? "" : src.trim(); }
    Object parse() { skip(); Object v = value(); skip(); return v; }
    Object value() {
      skip();
      if (match('{')) return object();
      if (match('[')) return array();
      if (peek() == '"') return string();
      if (src.startsWith("true", pos)) { pos += 4; return true; }
      if (src.startsWith("false", pos)) { pos += 5; return false; }
      if (src.startsWith("null", pos)) { pos += 4; return null; }
      return number();
    }
    Map<String, Object> object() {
      Map<String, Object> out = new LinkedHashMap<>();
      skip(); if (match('}')) return out;
      while (true) {
        String key = string(); expect(':'); out.put(key, value()); skip();
        if (match('}')) return out; expect(',');
      }
    }
    List<Object> array() {
      List<Object> out = new ArrayList<>();
      skip(); if (match(']')) return out;
      while (true) { out.add(value()); skip(); if (match(']')) return out; expect(','); }
    }
    String string() {
      expect('"'); StringBuilder b = new StringBuilder();
      while (pos < src.length()) {
        char c = src.charAt(pos++);
        if (c == '"') break;
        if (c == '\\' && pos < src.length()) {
          char e = src.charAt(pos++);
          if (e == 'n') c = '\n';
          else if (e == 't') c = '\t';
          else if (e == 'r') c = '\r';
          else if (e == 'u' && pos + 4 <= src.length()) {
            c = (char) Integer.parseInt(src.substring(pos, pos + 4), 16);
            pos += 4;
          } else c = e;
        }
        b.append(c);
      }
      return b.toString();
    }
    Number number() {
      int start = pos; if (peek() == '-') pos++;
      while (pos < src.length() && Character.isDigit(src.charAt(pos))) pos++;
      boolean floating = false;
      if (pos < src.length() && src.charAt(pos) == '.') { floating = true; pos++; while (pos < src.length() && Character.isDigit(src.charAt(pos))) pos++; }
      if (pos < src.length() && (src.charAt(pos) == 'e' || src.charAt(pos) == 'E')) {
        floating = true; pos++; if (peek() == '+' || peek() == '-') pos++; while (pos < src.length() && Character.isDigit(src.charAt(pos))) pos++;
      }
      String text = src.substring(start, pos);
      return floating ? Double.parseDouble(text) : Long.parseLong(text);
    }
    void skip() { while (pos < src.length() && Character.isWhitespace(src.charAt(pos))) pos++; }
    char peek() { return pos < src.length() ? src.charAt(pos) : '\0'; }
    boolean match(char c) { skip(); if (peek() == c) { pos++; return true; } return false; }
    void expect(char c) { skip(); if (peek() != c) throw new IllegalArgumentException("expected " + c); pos++; }
  }
}
`

const javaCore = `package dev.ax;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class Core {
  private Core() {}

  static boolean truthy(Object value) {
    if (value == null) return false;
    if (value instanceof Boolean b) return b;
    if (value instanceof String s) return !s.isEmpty();
    if (value instanceof Number n) return n.doubleValue() != 0.0;
    if (value instanceof Map<?, ?> m) return !m.isEmpty();
    if (value instanceof Iterable<?> i) return i.iterator().hasNext();
    return true;
  }
  static Object truthyValue(Object value) { return truthy(value); }
  static Object not(Object value) { return !truthy(value); }
  static Object and(Object left, Object right) { return truthy(left) && truthy(right); }
  static Object or(Object left, Object right) { return truthy(left) || truthy(right); }
  static Object eq(Object left, Object right) { return java.util.Objects.equals(left, right); }
  static Object ne(Object left, Object right) { return !java.util.Objects.equals(left, right); }
  static Object lt(Object left, Object right) { return asDouble(left) < asDouble(right); }
  static Object lte(Object left, Object right) { return asDouble(left) <= asDouble(right); }
  static Object gt(Object left, Object right) { return asDouble(left) > asDouble(right); }
  static Object gte(Object left, Object right) { return asDouble(left) >= asDouble(right); }
  static Object add(Object left, Object right) {
    if (left instanceof Number || right instanceof Number) return asDouble(left) + asDouble(right);
    return String.valueOf(left) + String.valueOf(right);
  }
  static Object mul(Object left, Object right) { return asDouble(left) * asDouble(right); }
  static Object div(Object left, Object right) {
    double denom = asDouble(right);
    return asDouble(left) / (denom == 0.0 ? 1.0 : denom);
  }
  static Object contains(Object container, Object item) {
    if (container == null) return false;
    if (container instanceof Map<?, ?> map) return map.containsKey(item);
    if (container instanceof Iterable<?> list) { for (Object value : list) if (java.util.Objects.equals(value, item)) return true; return false; }
    return String.valueOf(container).contains(String.valueOf(item));
  }
  static Object len(Object value) {
    if (value == null) return 0;
    if (value instanceof String s) return s.length();
    if (value instanceof Map<?, ?> m) return m.size();
    if (value instanceof List<?> l) return l.size();
    if (value instanceof Iterable<?> i) { int n = 0; for (Object ignored : i) n++; return n; }
    return 0;
  }
  static Object isNone(Object value) { return value == null; }
  static Object isNotNone(Object value) { return value != null; }
  static Object none() { return null; }
  static Object coalesce(Object value, Object fallback) { return value == null ? fallback : value; }

  @SuppressWarnings("unchecked")
  static Map<String, Object> asMap(Object value) {
    if (value == null) return new LinkedHashMap<>();
    if (value instanceof Map<?, ?> map) return (Map<String, Object>) map;
    return new LinkedHashMap<>();
  }
  @SuppressWarnings("unchecked")
  static List<Object> asList(Object value) {
    if (value instanceof List<?> list) return (List<Object>) list;
    if (value instanceof Iterable<?> iterable) { List<Object> out = new ArrayList<>(); for (Object item : iterable) out.add(item); return out; }
    return new ArrayList<>();
  }
  @SuppressWarnings("unchecked")
  static List<Map<String, Object>> asMapList(Object value) {
    List<Map<String, Object>> out = new ArrayList<>();
    for (Object item : asList(value)) out.add(asMap(item));
    return out;
  }
  @SuppressWarnings("unchecked")
  static List<Field> asFields(Object value) {
    if (value instanceof List<?> list) return (List<Field>) list;
    return List.of();
  }
  static int asInt(Object value) { return value instanceof Number n ? n.intValue() : Integer.parseInt(String.valueOf(value)); }
  static double asDouble(Object value) { return value instanceof Number n ? n.doubleValue() : Double.parseDouble(String.valueOf(value)); }
  static String stringStr(Object value) { return display(value); }

  static Object get(Object target, Object key, Object defaultValue) {
    if (target == null) return defaultValue;
    if (target instanceof Map<?, ?> map) return map.containsKey(key) ? map.get(key) : defaultValue;
    if (target instanceof List<?> list && key instanceof Number n) {
      int idx = n.intValue();
      return idx >= 0 && idx < list.size() ? list.get(idx) : defaultValue;
    }
    String k = String.valueOf(key);
    if (target instanceof Field f) {
      return switch (k) {
        case "name" -> f.name;
        case "type" -> f.type;
        case "description" -> f.description;
        case "title" -> f.title;
        case "is_optional", "isOptional" -> f.optional;
        case "is_internal", "isInternal" -> f.internal;
        case "is_cached", "isCached" -> f.cached;
        default -> defaultValue;
      };
    }
    if (target instanceof FieldType t) {
      return switch (k) {
        case "name" -> t.name;
        case "is_array", "isArray" -> t.array;
        case "options" -> t.options;
        case "fields" -> t.fields;
        case "min_length", "minLength" -> t.minLength;
        case "max_length", "maxLength" -> t.maxLength;
        case "minimum" -> t.minimum;
        case "maximum" -> t.maximum;
        case "pattern" -> t.pattern;
        case "pattern_description", "patternDescription" -> t.patternDescription;
        case "format" -> t.format;
        case "description" -> t.description;
        default -> defaultValue;
      };
    }
    if (target instanceof AxSignature s) {
      return switch (k) {
        case "description" -> s.description;
        case "inputs", "input_fields" -> s.inputs;
        case "outputs", "output_fields" -> s.outputs;
        default -> defaultValue;
      };
    }
    if (target instanceof AxGen g) {
      return switch (k) {
        case "signature" -> g.signature;
        case "options" -> g.options;
        case "functions" -> g.functions;
        case "prompt_template" -> g.promptTemplate;
        case "examples" -> g.examples;
        case "demos" -> g.demos;
        case "assertions" -> g.assertions;
	        case "field_processors", "fieldProcessors" -> g.fieldProcessors;
	        case "stop_functions", "stopFunctions" -> g.stopFunctions;
	        case "memory" -> g.memory;
	        case "chat_log", "chatLog" -> g.chatLog;
	        case "function_call_traces", "functionCallTraces" -> g.functionCallTraces;
	        case "traces" -> g.traces;
        default -> defaultValue;
      };
    }
    if (target instanceof AxAgent a) {
      return switch (k) {
        case "state" -> a.state;
        case "signature" -> a.signature;
        case "distiller" -> a.distiller;
        case "executor" -> a.executor;
        case "responder" -> a.responder;
        case "options" -> a.options;
        default -> defaultValue;
      };
    }
    if (target instanceof AxCodeRuntime r) {
      return switch (k) {
        case "language" -> r.language();
        case "usageInstructions", "usage_instructions" -> r.getUsageInstructions();
        default -> defaultValue;
      };
    }
    if (target instanceof Tool t) {
      return switch (k) {
        case "name" -> t.name;
        case "description" -> t.description;
        case "parameters" -> t.schema();
        case "args" -> t.args;
        case "returns" -> t.returns;
        default -> defaultValue;
      };
    }
    return defaultValue;
  }

  @SuppressWarnings("unchecked")
  static void set(Object target, Object key, Object value) {
    if (target instanceof Map<?, ?> map) ((Map<Object, Object>) map).put(key, value);
    else throw new IllegalArgumentException("core.set target must be a map");
  }
  @SuppressWarnings("unchecked")
  static void append(Object target, Object value) {
    if (target instanceof List<?> list) ((List<Object>) list).add(value);
    else throw new IllegalArgumentException("core.append target must be a list");
  }
  static Iterable<Object> iter(Object value) {
    if (value instanceof Map<?, ?> map) {
      List<Object> keys = new ArrayList<>();
      for (Object key : map.keySet()) keys.add(key);
      return keys;
    }
    return asList(value);
  }
  static RuntimeException asRuntime(Object error) {
    if (error instanceof RuntimeException e) return e;
    return new RuntimeException(String.valueOf(error));
  }

  static Object mapMerge(Object left, Object right) {
    Map<String, Object> out = new LinkedHashMap<>(asMap(left));
    out.putAll(asMap(right));
    return out;
  }
  static Object mapContains(Object values, Object key) { return values instanceof Map<?, ?> map && map.containsKey(key); }
  static Object mapGet(Object values, Object key) { return asMap(values).get(key); }
  static Object mapDelete(Object values, Object key) { asMap(values).remove(key); return values; }
  static Object mapUpdate(Object target, Object values) { asMap(target).putAll(asMap(values)); return target; }
  static Object mapKeys(Object values) { return new ArrayList<>(asMap(values).keySet()); }
  static Object mapValues(Object values) { return new ArrayList<>(asMap(values).values()); }
  static Object listGet(Object values, Object index, Object defaultValue) {
    List<Object> list = asList(values);
    int i = asInt(index);
    return i >= 0 && i < list.size() ? list.get(i) : defaultValue;
  }
  static Object typeIs(Object value, Object typeName) {
    return switch (String.valueOf(typeName)) {
      case "object" -> value instanceof Map<?, ?>;
      case "list" -> value instanceof List<?>;
      case "string" -> value instanceof String;
      case "number" -> value instanceof Number && !(value instanceof Boolean);
      case "boolean" -> value instanceof Boolean;
      case "null" -> value == null;
      case "json" -> value == null || value instanceof Map<?, ?> || value instanceof List<?> || value instanceof String || value instanceof Number || value instanceof Boolean;
      default -> false;
    };
  }
  static boolean regexMatch(Object pattern, Object value) { return value instanceof String s && Pattern.compile(String.valueOf(pattern)).matcher(s).find(); }
  static Object stringTrim(Object value) { return String.valueOf(value).trim(); }
  static Object stringJoin(Object sep, Object values) { List<String> parts = new ArrayList<>(); for (Object item : asList(values)) parts.add(String.valueOf(item)); return String.join(String.valueOf(sep), parts); }
  static Object stringLower(Object value) { return String.valueOf(value).toLowerCase(java.util.Locale.ROOT); }
  static Object stringLowerCamel(Object values) {
    List<Object> words = asList(values);
    if (words.isEmpty()) return "";
    StringBuilder out = new StringBuilder(String.valueOf(words.get(0)).toLowerCase(java.util.Locale.ROOT));
    for (int i = 1; i < words.size(); i++) {
      String lower = String.valueOf(words.get(i)).toLowerCase(java.util.Locale.ROOT);
      if (!lower.isEmpty()) out.append(Character.toUpperCase(lower.charAt(0))).append(lower.substring(1));
    }
    return out.toString();
  }
  static Object stringTitleFromCamel(Object value) {
    String text = String.valueOf(value).replaceAll("Code$", " Code").replaceAll("([a-z0-9])([A-Z])", "$1 $2").trim();
    return text.isEmpty() ? text : Character.toUpperCase(text.charAt(0)) + text.substring(1);
  }
  static Object stringEndsWith(Object value, Object suffix) { return String.valueOf(value).endsWith(String.valueOf(suffix)); }
  static Object stringStartsWith(Object value, Object prefix) { return value instanceof String s && s.startsWith(String.valueOf(prefix)); }
  static Object stringReplace(Object value, Object oldValue, Object newValue) { return String.valueOf(value).replace(String.valueOf(oldValue), String.valueOf(newValue)); }
  static Object stringSlice(Object value, Object start, Object end) {
    String text = String.valueOf(value);
    int s = asInt(start);
    if (end == null) return text.substring(s);
    return text.substring(s, asInt(end));
  }
  static Object stringSlice(Object value, Object start) { return stringSlice(value, start, null); }
  static Object stringRemoveSuffix(Object value, Object suffix) {
    String text = String.valueOf(value), suf = String.valueOf(suffix);
    Map<String, Object> out = new LinkedHashMap<>();
    if (!suf.isEmpty() && text.endsWith(suf)) { out.put("value", text.substring(0, text.length() - suf.length())); out.put("removed", true); }
    else { out.put("value", text); out.put("removed", false); }
    return out;
  }
  static Object stringWords(Object value) { return Arrays.asList(String.valueOf(value).split("\\s+")); }
  static Object stringDefaultIfEmpty(Object value, Object fallback) { String text = String.valueOf(value).trim(); return text.isEmpty() ? fallback : text; }
  static Object stringFormat(Object template, Object... args) {
    String out = String.valueOf(template);
    for (Object arg : args) {
      int index = out.indexOf("{}");
      if (index < 0) break;
      out = out.substring(0, index) + display(arg) + out.substring(index + 2);
    }
    return out;
  }
  static String display(Object value) {
    if (value instanceof Number n) {
      double d = n.doubleValue();
      if (Math.rint(d) == d) return String.valueOf((long) d);
    }
    return String.valueOf(value);
  }
  static Object stringSplit(Object value, Object sep) { return Arrays.asList(String.valueOf(value).split(Pattern.quote(String.valueOf(sep)), -1)); }
  static Object stringSplitOnce(Object value, Object sep) {
    String text = String.valueOf(value), s = String.valueOf(sep);
    int idx = text.indexOf(s);
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("found", idx >= 0);
    out.put("left", idx >= 0 ? text.substring(0, idx) : text);
    out.put("right", idx >= 0 ? text.substring(idx + s.length()) : "");
    return out;
  }
  static Object stringSplitTrimNonEmpty(Object value, Object sep) {
    List<Object> out = new ArrayList<>();
    for (String part : String.valueOf(value).split(Pattern.quote(String.valueOf(sep)))) if (!part.trim().isEmpty()) out.add(part.trim());
    return out;
  }
  static Object stringFindOutsideQuotes(Object text, Object needle) {
    String s = String.valueOf(text), n = String.valueOf(needle);
    Character quote = null; boolean escaped = false;
    for (int i = 0; i < s.length(); i++) {
      char ch = s.charAt(i);
      if (escaped) { escaped = false; continue; }
      if (ch == '\\') { escaped = true; continue; }
      if (quote != null) { if (ch == quote) quote = null; continue; }
      if (ch == '\'' || ch == '"') { quote = ch; continue; }
      if (s.startsWith(n, i)) return i;
    }
    if (quote != null) throw new AxSignatureError("Unterminated string");
    return -1;
  }
  static Object stringSplitOutsideQuotes(Object text, Object sep) {
    String s = String.valueOf(text); char separator = String.valueOf(sep).charAt(0);
    List<Object> out = new ArrayList<>(); StringBuilder cur = new StringBuilder(); Character quote = null; boolean escaped = false;
    for (int i = 0; i < s.length(); i++) {
      char ch = s.charAt(i);
      if (escaped) { cur.append(ch); escaped = false; continue; }
      if (ch == '\\') { cur.append(ch); escaped = true; continue; }
      if (quote != null) { cur.append(ch); if (ch == quote) quote = null; continue; }
      if (ch == '\'' || ch == '"') { cur.append(ch); quote = ch; continue; }
      if (ch == separator) { String item = cur.toString().trim(); if (!item.isEmpty()) out.add(item); cur = new StringBuilder(); continue; }
      cur.append(ch);
    }
    if (quote != null) throw new AxSignatureError("Unterminated string");
    String item = cur.toString().trim(); if (!item.isEmpty()) out.add(item);
    return out;
  }
  static Object stringConsumeOptionalQuotedPrefix(Object text) {
    String s = String.valueOf(text);
    Map<String, Object> out = new LinkedHashMap<>();
    if (s.isEmpty() || (s.charAt(0) != '\'' && s.charAt(0) != '"')) { out.put("value", null); out.put("rest", s); out.put("found", false); return out; }
    char quote = s.charAt(0); boolean escaped = false; StringBuilder val = new StringBuilder();
    for (int i = 1; i < s.length(); i++) {
      char ch = s.charAt(i);
      if (escaped) { val.append(ch); escaped = false; }
      else if (ch == '\\') escaped = true;
      else if (ch == quote) { out.put("value", val.toString()); out.put("rest", s.substring(i + 1)); out.put("found", true); return out; }
      else val.append(ch);
    }
    throw new AxSignatureError("Unterminated string");
  }
  static Object stringExtractQuotedSuffix(Object text) {
    String s = String.valueOf(text); boolean escaped = false;
    for (int i = 0; i < s.length(); i++) {
      char ch = s.charAt(i);
      if (escaped) { escaped = false; continue; }
      if (ch == '\\') { escaped = true; continue; }
      if (ch == '\'' || ch == '"') {
        Map<String, Object> consumed = asMap(stringConsumeOptionalQuotedPrefix(s.substring(i)));
        Map<String, Object> out = new LinkedHashMap<>(consumed);
        out.put("index", i); out.put("head", s.substring(0, i)); return out;
      }
    }
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("value", null); out.put("index", null); out.put("rest", ""); out.put("head", s); out.put("found", false);
    return out;
  }
  static Object regexReplace(Object pattern, Object repl, Object value) { return String.valueOf(value).replaceAll(String.valueOf(pattern), Matcher.quoteReplacement(String.valueOf(repl))); }
  static Object sortedStrings(Object values) { List<String> out = new ArrayList<>(); for (Object item : asList(values)) out.add(String.valueOf(item)); out.sort(String::compareTo); return out; }
  static Object jsonParse(Object value) {
    String text = String.valueOf(value).trim();
    String fence = String.valueOf((char) 96).repeat(3);
    if (text.startsWith(fence)) {
      text = text.replace(String.valueOf((char) 96), "").trim();
      if (text.startsWith("json")) text = text.substring(4).trim();
    }
    return Json.parse(text);
  }
  static Object jsonStringify(Object value) { return Json.stringify(value); }
  static Object jsonStableStringify(Object value) { return Json.stableStringify(value); }
  static Object jsonPretty(Object value) { return Json.pretty(value); }

  static Object signatureError(Object message) { return new AxSignatureError(String.valueOf(message)); }
  static Object validationError(Object message) { return new AxValidationError(String.valueOf(message)); }
  static Object runtimeError(Object message) { return new RuntimeException(String.valueOf(message)); }
  static Object exceptionMessage(Object error) { return error instanceof Throwable t ? t.getMessage() : String.valueOf(error); }
  static Object aiErrorResponse(Object message) { return new AxAIServiceResponseError(String.valueOf(message)); }
  static Object aiErrorResponse(Object message, Object responseBody) { return new AxAIServiceResponseError(String.valueOf(message), responseBody); }
  static Object aiErrorRefusal(Object message, Object responseBody) { return new AxAIRefusalError(String.valueOf(message), responseBody); }
  static Object aiErrorStream(Object message, Object responseBody, Object retryable) { return new AxAIServiceStreamTerminatedError(String.valueOf(message), responseBody, truthy(retryable)); }
  static Object aiErrorUnsupported(Object message) { return new AxUnsupportedCapabilityError(String.valueOf(message)); }
  static Object aiErrorAuth(Object message, Object status, Object code, Object responseBody, Object request) { return new AxAIServiceAuthenticationError(String.valueOf(message), status == null ? null : asInt(status), code == null ? null : String.valueOf(code), responseBody, request); }
  static Object aiErrorTimeout(Object message, Object status, Object code, Object responseBody, Object request, Object retryable) { return new AxAIServiceTimeoutError(String.valueOf(message), status == null ? null : asInt(status), code == null ? null : String.valueOf(code), responseBody, request, truthy(retryable)); }
  static Object aiErrorStatus(Object message, Object status, Object code, Object responseBody, Object request, Object retryable) { return new AxAIServiceStatusError(String.valueOf(message), status == null ? null : asInt(status), code == null ? null : String.valueOf(code), responseBody, request, truthy(retryable)); }

  static Object recordNew(Object name, Object values) {
    Map<String, Object> v = asMap(values);
    return switch (String.valueOf(name)) {
      case "FieldType" -> fieldTypeFromMap(v);
      case "Field" -> fieldFromMap(v);
      case "AxSignature" -> new AxSignature((String) v.get("description"), asFields(v.get("inputs")), asFields(v.get("outputs")));
      default -> throw new AxSignatureError("Unknown record type: " + name);
    };
  }
  static FieldType fieldTypeFromMap(Map<String, Object> v) {
    FieldType t = new FieldType((String) v.getOrDefault("name", v.getOrDefault("type", "string")));
    t.array = truthy(v.getOrDefault("is_array", v.getOrDefault("isArray", false)));
    Object opts = v.get("options"); if (opts instanceof List<?> list) { List<String> out = new ArrayList<>(); for (Object item : list) out.add(String.valueOf(item)); t.options = out; }
    Object fields = v.get("fields"); if (fields instanceof Map<?, ?> map) t.fields = asMap(map);
    if (v.get("minLength") != null || v.get("min_length") != null) t.minLength = asInt(v.getOrDefault("minLength", v.get("min_length")));
    if (v.get("maxLength") != null || v.get("max_length") != null) t.maxLength = asInt(v.getOrDefault("maxLength", v.get("max_length")));
    if (v.get("minimum") != null) t.minimum = asDouble(v.get("minimum"));
    if (v.get("maximum") != null) t.maximum = asDouble(v.get("maximum"));
    t.pattern = (String) v.get("pattern");
    t.patternDescription = (String) v.getOrDefault("patternDescription", v.get("pattern_description"));
    t.format = (String) v.get("format");
    t.description = (String) v.get("description");
    return t;
  }
  static Field fieldFromMap(Map<String, Object> v) {
    Object typ = v.get("type");
    FieldType fieldType = typ instanceof FieldType ft ? ft : typ instanceof Map<?, ?> map ? fieldTypeFromMap(asMap(map)) : new FieldType("string");
    return new Field(
      String.valueOf(v.get("name")),
      fieldType,
      (String) v.get("description"),
      (String) v.get("title"),
      truthy(v.getOrDefault("is_optional", v.getOrDefault("isOptional", false))),
      truthy(v.getOrDefault("is_internal", v.getOrDefault("isInternal", false))),
      truthy(v.getOrDefault("is_cached", v.getOrDefault("isCached", false)))
    );
  }
  static Object fieldsFromMap(Object fields) {
    List<Object> out = new ArrayList<>();
    for (Map.Entry<String, Object> e : asMap(fields).entrySet()) {
      Object item = e.getValue();
      if (item instanceof Field f) out.add(f);
      else if (item instanceof FieldType ft) out.add(new Field(e.getKey(), ft, ft.description, false, false, false));
      else if (item instanceof Map<?, ?> map) { Map<String, Object> v = asMap(map); v.putIfAbsent("name", e.getKey()); out.add(fieldFromMap(v)); }
    }
    return out;
  }
  static Object fieldItem(Object field) {
    Field f = (Field) field;
    FieldType t = f.type.copy();
    t.array = false;
    return new Field(f.name, t, f.description, f.title, f.optional, f.internal, f.cached);
  }
  static String title(String name) {
    String s = name == null ? "" : name.replace("_", " ");
    StringBuilder out = new StringBuilder();
    for (int i = 0; i < s.length(); i++) {
      char ch = s.charAt(i);
      if (i > 0 && (Character.isUpperCase(ch) || Character.isDigit(ch))) out.append(' ');
      out.append(ch);
    }
    String text = out.toString().trim();
    return text.isEmpty() ? text : text.substring(0, 1).toUpperCase() + text.substring(1);
  }
  static Object descriptionAppend(Object base, Object hint) {
    if (hint == null || String.valueOf(hint).trim().isEmpty()) return base;
    if (base == null || String.valueOf(base).trim().isEmpty()) return String.valueOf(hint);
    String text = String.valueOf(base).trim();
    if (!text.endsWith(".")) text += ".";
    return text + " " + hint;
  }
  static Object urlValid(Object value) { return value instanceof String s && Pattern.compile("^[a-zA-Z][a-zA-Z0-9+.-]*://").matcher(s).find(); }
  static Object validImage(Object value) { return value instanceof Map<?, ?> map && map.containsKey("mimeType") && map.containsKey("data"); }
  static Object validAudio(Object value) { return value instanceof String || (value instanceof Map<?, ?> map && (map.containsKey("data") || map.containsKey("id"))); }
  static Object validFile(Object value) { return value instanceof Map<?, ?> map && map.containsKey("mimeType") && (map.containsKey("data") ^ map.containsKey("fileUri")); }
  static Object validUrlShape(Object value) { return value instanceof String || (value instanceof Map<?, ?> map && map.containsKey("url")); }

  static Object objectCallMethod(Object target, Object methodName, Object... args) {
    if (target instanceof PromptTemplate p && "render".equals(String.valueOf(methodName))) return p.render(asMap(args.length > 0 ? args[0] : null));
    if (target instanceof AxFlow.Mapper mapper && "call".equals(String.valueOf(methodName))) return mapper.apply(asMap(args.length > 0 ? args[0] : null));
    throw new RuntimeException("unsupported method call: " + methodName);
  }
  static Object programComponents(Object program) {
    if (program instanceof AxProgram axProgram) return axProgram.getOptimizableComponents();
    return List.of();
  }
  static Object programApplyComponents(Object program, Object componentMap) {
    if (program instanceof AxProgram axProgram) axProgram.applyOptimizedComponents(asMap(componentMap));
    return Map.of();
  }
  static Object aiCompleteOnce(Object client, Object request) {
    try {
      if (client instanceof AxAIService service) return chat_response_to_completion(service.chat(asMap(request)));
      if (client instanceof AiClient ai) return ai.complete(asMap(request));
      throw new RuntimeException("client does not implement AiClient");
    } catch (RuntimeException e) {
      throw e;
    } catch (Exception e) {
      throw new RuntimeException(e.getMessage(), e);
    }
  }
  static Object retrySleep(Object attempt) { return null; }
  static Object toolInvoke(Object fn, Object params) {
    if (!(fn instanceof Tool tool)) throw new RuntimeException("unknown tool");
    return tool.call(asMap(params));
  }

  static Map<String, Object> legacyResponseToChatResponse(Map<String, Object> raw) {
    if (raw.containsKey("results")) return raw;
    List<Object> calls = new ArrayList<>();
    for (Object item : asList(raw.get("function_calls"))) {
      Map<String, Object> call = asMap(item);
      Map<String, Object> fn = new LinkedHashMap<>();
      fn.put("name", call.get("name"));
      fn.put("params", call.get("params"));
      Map<String, Object> out = new LinkedHashMap<>();
      out.put("id", call.get("id"));
      out.put("type", "function");
      out.put("function", fn);
      calls.add(out);
    }
    Map<String, Object> result = new LinkedHashMap<>();
    result.put("index", 0);
    result.put("content", raw.getOrDefault("content", ""));
    result.put("function_calls", calls);
    result.put("finish_reason", raw.getOrDefault("finish_reason", "stop"));
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("results", List.of(result));
    if (raw.get("usage") != null) out.put("model_usage", Map.of("tokens", raw.get("usage")));
    return out;
  }
  static Map<String, Object> coerceChatRequest(Map<String, Object> request) {
    if (request.containsKey("chat_prompt")) return new LinkedHashMap<>(request);
    if (request.containsKey("chatPrompt")) { Map<String, Object> out = new LinkedHashMap<>(request); out.put("chat_prompt", out.remove("chatPrompt")); return out; }
    if (request.containsKey("messages")) {
      Map<String, Object> out = new LinkedHashMap<>();
      out.put("chat_prompt", request.get("messages"));
      out.put("functions", request.getOrDefault("functions", List.of()));
      out.put("function_call", request.getOrDefault("function_call", request.get("tool_choice")));
      out.put("response_format", request.get("response_format"));
      out.put("model", request.get("model"));
      out.put("model_config", request.getOrDefault("model_config", Map.of()));
      return out;
    }
    return new LinkedHashMap<>(request);
  }
  static Map<String, Object> defaultFeatures() {
    return Map.of("functions", true, "streaming", true, "structured_outputs", true, "multi_turn", true);
  }

  static Object templateParse(Object template, Object context) { return TemplateEngine.parse(String.valueOf(template), String.valueOf(context)); }
  static Object templateRenderTree(Object nodes, Object vars, Object source, Object context) { return TemplateEngine.render(asList(nodes), asMap(vars), String.valueOf(source), String.valueOf(context)); }
  static Object templateCollectVars(Object nodes) { return TemplateEngine.collect(asList(nodes)); }
  static Object templateValidate(Object source, Object context, Object required) { return TemplateEngine.validate(String.valueOf(source), String.valueOf(context), asList(required)); }
  static Object promptStructured(Object signature, Object values, Object functions, Object options) { return PromptRuntime.structured((AxSignature) signature, asMap(values), asList(functions), asMap(options)); }
  static Object promptUserContent(Object signature, Object values) { return PromptRuntime.userContent((AxSignature) signature, asMap(values)); }
  static Object openai_normalize_chat_response(Object raw) { return openai_normalize_chat_response(raw, "openai", null); }
  static Object openai_normalize_stream_delta(Object raw, Object state) { return openai_normalize_stream_delta(raw, state, "openai", null); }
  static Object openai_normalize_embed_response(Object raw) { return openai_normalize_embed_response(raw, "openai", null); }
  static Object axgenRenderExamples(Object gen) {
    if (truthy(asMap(get(gen, "options", Map.of())).get("examplesInSystem"))) return List.of();
    return axgenRenderTurns(gen, asList(get(gen, "examples", List.of())), "Example");
  }
  static Object axgenRenderDemos(Object gen) {
    if (truthy(asMap(get(gen, "options", Map.of())).get("examplesInSystem"))) return List.of();
    return axgenRenderTurns(gen, asList(get(gen, "demos", List.of())), "Demo");
  }
  static String axgenValueText(Object value) {
    if (value instanceof String s) return s;
    return Json.stringify(value);
  }
  static String axgenFormatValues(Object gen, Object values, String kind) {
    Map<String, Object> map = asMap(values);
    List<String> lines = new ArrayList<>();
    for (Object raw : asList(get(get(gen, "signature", null), kind + "_fields", List.of()))) {
      Field field = (Field) raw;
      if (map.containsKey(field.name)) lines.add(field.title + ": " + axgenValueText(map.get(field.name)));
    }
    if (lines.isEmpty()) for (Map.Entry<String, Object> e : map.entrySet()) lines.add(e.getKey() + ": " + axgenValueText(e.getValue()));
    return String.join("\n", lines);
  }
  static Object axgenRenderTurns(Object gen, List<Object> turns, String label) {
    List<Object> out = new ArrayList<>();
    for (Object item : turns) {
      Map<String, Object> turn = asMap(item);
      if ("Demo".equals(label) && !turn.containsKey("input") && !turn.containsKey("values")) continue;
      Object input = turn.getOrDefault("input", turn.getOrDefault("values", Map.of()));
      Object output = turn.getOrDefault("output", turn.getOrDefault("expected_output", Map.of()));
      out.add(new LinkedHashMap<>(Map.of("role", "user", "content", label + " Input:\n" + axgenFormatValues(gen, input, "input"))));
      out.add(new LinkedHashMap<>(Map.of("role", "assistant", "content", label + " Output:\n" + axgenFormatValues(gen, output, "output"))));
    }
    return out;
  }
  static Object axgenApplyContextCache(Object gen, Object rawMessages, Object runtimeOptions) {
    List<Object> messages = new ArrayList<>();
    for (Object raw : asList(rawMessages)) messages.add(new LinkedHashMap<>(asMap(raw)));
    Map<String, Object> options = new LinkedHashMap<>(asMap(get(gen, "options", Map.of())));
    options.putAll(asMap(runtimeOptions));
    if (truthy(options.get("examplesInSystem")) && !messages.isEmpty()) {
      List<String> blocks = new ArrayList<>();
      for (Object message : asList(axgenRenderTurns(gen, asList(get(gen, "examples", List.of())), "Example"))) blocks.add(String.valueOf(asMap(message).getOrDefault("content", "")));
      for (Object message : asList(axgenRenderTurns(gen, asList(get(gen, "demos", List.of())), "Demo"))) blocks.add(String.valueOf(asMap(message).getOrDefault("content", "")));
      if (!blocks.isEmpty()) {
        Map<String, Object> system = asMap(messages.get(0));
        system.put("content", String.valueOf(system.getOrDefault("content", "")) + "\n\n--- EXAMPLES ---\n" + String.join("\n\n", blocks) + "\n--- END OF EXAMPLES ---");
      }
    }
    Object contextCache = options.getOrDefault("context_cache", options.get("contextCache"));
    if (!truthy(contextCache) || truthy(options.get("ignore_cache_breakpoints"))) return messages;
    if (!messages.isEmpty()) asMap(messages.get(0)).put("cache", true);
    Object breakpoint = contextCache instanceof Map<?, ?> map ? asMap(map).getOrDefault("breakpoint", asMap(map).getOrDefault("cache_breakpoint", asMap(map).get("cacheBreakpoint"))) : "after_examples";
    if (breakpoint == null || "after_examples".equals(breakpoint) || "afterExamples".equals(breakpoint)) {
      for (int i = messages.size() - 2; i >= 0; i--) {
        Map<String, Object> msg = asMap(messages.get(i));
        if ("assistant".equals(msg.get("role")) || "tool".equals(msg.get("role"))) { msg.put("cache", true); break; }
      }
    }
    return messages;
  }
  static Object axgenApplyFieldProcessors(Object gen, Object output) {
    Map<String, Object> result = new LinkedHashMap<>(asMap(output));
    boolean changed = false;
    for (Object raw : asList(get(gen, "field_processors", List.of()))) {
      Map<String, Object> spec = asMap(raw);
      String field = String.valueOf(spec.getOrDefault("field", spec.get("name")));
      if (field == null || "null".equals(field) || !result.containsKey(field)) continue;
      Object processor = spec.getOrDefault("processor", spec.get("op"));
      if (processor instanceof AxGen.FieldProcessorCallback cb) {
        result.put(field, cb.apply(result.get(field)));
        changed = true;
        continue;
      }
      String op = String.valueOf(processor);
      Object value = result.get(field);
      if ("uppercase".equals(op)) { result.put(field, String.valueOf(value).toUpperCase()); changed = true; }
      else if ("lowercase".equals(op)) { result.put(field, String.valueOf(value).toLowerCase()); changed = true; }
      else if ("trim".equals(op)) { result.put(field, String.valueOf(value).trim()); changed = true; }
      else if (op.startsWith("prefix:")) { result.put(field, op.substring(7) + String.valueOf(value)); changed = true; }
      else if (op.startsWith("suffix:")) { result.put(field, String.valueOf(value) + op.substring(7)); changed = true; }
    }
    if (changed && get(gen, "memory", null) instanceof AxMemory mem) mem.addProcessorOutput(result);
    return result;
  }
  static Object axgenRunAssertions(Object gen, Object output) {
    Map<String, Object> map = asMap(output);
    for (Object raw : asList(get(gen, "assertions", List.of()))) {
      if (raw instanceof AxGen.AssertionCallback cb) {
        Object returned = cb.apply(map);
        if (returned instanceof String s) throw new RuntimeException(s);
        if (Boolean.FALSE.equals(returned)) throw new RuntimeException("assertion failed");
        continue;
      }
      Map<String, Object> assertion = asMap(raw);
      Object field = assertion.get("field");
      Object value = field == null ? output : map.get(String.valueOf(field));
      String message = String.valueOf(assertion.getOrDefault("message", "assertion failed"));
      if (assertion.containsKey("return")) {
        Object returned = assertion.get("return");
        if (returned == null) continue;
        if (Boolean.FALSE.equals(returned) && !assertion.containsKey("message")) throw new RuntimeException("assertion failed without message");
        if (Boolean.FALSE.equals(returned)) throw new RuntimeException(message);
        if (returned instanceof String s) throw new RuntimeException(s);
      }
      if (assertion.containsKey("contains") && !String.valueOf(value).contains(String.valueOf(assertion.get("contains")))) throw new RuntimeException(message);
      if (assertion.containsKey("equals") && !java.util.Objects.equals(value, assertion.get("equals"))) throw new RuntimeException(message);
    }
    return null;
  }
  static Object axgenRecordTrace(Object gen, Object values, Object output, Object status) {
    Object traces = get(gen, "traces", List.of());
    Map<String, Object> trace = new LinkedHashMap<>();
    trace.put("status", String.valueOf(status));
    trace.put("input", values);
    trace.put("output", output);
    trace.put("chat_log", new ArrayList<>(asList(get(gen, "chat_log", List.of()))));
    trace.put("function_calls", new ArrayList<>(asList(get(gen, "function_call_traces", List.of()))));
    asList(traces).add(trace);
    return null;
  }
  static Object axgenMemoryAddRequest(Object gen, Object messages) {
    if (get(gen, "memory", null) instanceof AxMemory mem) mem.addRequest(messages);
    return null;
  }
  static Object axgenMemoryAddResponse(Object gen, Object request, Object response) {
    if (get(gen, "memory", null) instanceof AxMemory mem) mem.addResponse(response);
    return null;
  }
  static Object axgenMemoryAddFunctionResult(Object gen, Object call, Object result, Object ok) {
    if (get(gen, "memory", null) instanceof AxMemory mem) {
      Map<String, Object> item = new LinkedHashMap<>();
      item.put("call", call);
      item.put("result", result);
      item.put("ok", truthy(ok));
      mem.addFunctionResults(item);
    }
    return null;
  }
  static Object axgenMemoryAddCorrection(Object gen, Object response, Object error) {
    if (get(gen, "memory", null) instanceof AxMemory mem) mem.addCorrection(response, exceptionMessage(error));
    return null;
  }
  static Object axgenMemoryCleanupCorrections(Object gen) {
    if (get(gen, "memory", null) instanceof AxMemory mem) mem.removeByTag("correction");
    return null;
  }
  static Object axgenRecordChatLog(Object gen, Object request, Object response) {
    Map<String, Object> entry = new LinkedHashMap<>();
    entry.put("model", asMap(request).get("model"));
    entry.put("messages", asMap(request).getOrDefault("chat_prompt", List.of()));
    entry.put("response", response);
    entry.put("remote_id", asMap(response).getOrDefault("remote_id", asMap(response).get("id")));
    entry.put("session_id", asMap(response).get("session_id"));
    entry.put("usage", asMap(response).getOrDefault("usage", asMap(response).get("model_usage")));
    entry.put("function_calls", asMap(response).getOrDefault("function_calls", List.of()));
    asList(get(gen, "chat_log", List.of())).add(entry);
    return null;
  }
  static Object axgenRecordFunctionCall(Object gen, Object call, Object result, Object status) {
    Map<String, Object> c = asMap(call);
    Object fn = c.get("function");
    Map<String, Object> record = new LinkedHashMap<>();
    record.put("name", fn instanceof Map<?, ?> ? asMap(fn).get("name") : c.get("name"));
    record.put("id", c.get("id"));
    record.put("args", c.getOrDefault("params", c.getOrDefault("args", Map.of())));
    record.put("status", String.valueOf(status));
    record.put("result", result);
    asList(get(gen, "function_call_traces", List.of())).add(record);
    Object hook = asMap(get(gen, "options", Map.of())).getOrDefault("on_function_call", asMap(get(gen, "options", Map.of())).get("onFunctionCall"));
    if (hook instanceof AxGen.FunctionCallHook cb) {
      try { cb.accept(record); } catch (RuntimeException ignored) {}
    }
    return null;
  }
  static Object agentStageForward(Object stage, Object client, Object values, Object options) {
    if (!(stage instanceof AxProgram program)) throw new RuntimeException("agent stage is not AxProgram");
    if (!(client instanceof AiClient ai)) throw new RuntimeException("client does not implement AiClient");
    return program.forward(ai, asMap(values), asMap(options));
  }
  static Object agentStageChatLog(Object stage) {
    if (stage instanceof AxProgram program) return program.getChatLog();
    return List.of();
  }
  static Object agentStageUsage(Object stage) {
    if (stage instanceof AxProgram program) {
      Object usage = program.getUsage();
      if (truthy(usage)) return usage;
      List<Object> items = new ArrayList<>();
      for (Object rawEntry : program.getChatLog()) {
        Map<String, Object> entry = asMap(rawEntry);
        Object item = entry.get("usage");
        if (truthy(item)) items.add(item);
      }
      return items;
    }
    return List.of();
  }
  static Object agentStageTraces(Object stage) {
    if (stage instanceof AxProgram program) return program.getTraces();
    return List.of();
  }
  static Object agentClarificationError(Object payload, Object state) {
    Object args = get(payload, "args", List.of());
    Object clarification = asList(args).isEmpty() ? payload : asList(args).get(0);
    return new AxAgentClarificationException(clarification, get(state, "runtime_state", Map.of()), payload);
  }
  static Object agentRuntimeCreateSession(Object runtime, Object globals, Object options) {
    if (!(runtime instanceof AxCodeRuntime rt)) throw new RuntimeException("agent runtime does not implement AxCodeRuntime");
    AxCodeSession session = rt.createSession(asMap(globals), asMap(options));
    if (session == null) throw new RuntimeException("agent runtime returned no session");
    return session;
  }
  static Object agentRuntimeExecute(Object session, Object code, Object options) {
    if (!(session instanceof AxCodeSession active)) throw new RuntimeException("agent code session is not active");
    return active.execute(String.valueOf(code), asMap(options));
  }
  static Object agentRuntimeInspect(Object session, Object options) {
    if (!(session instanceof AxCodeSession active)) throw new RuntimeException("agent code session is not active");
    return active.inspectGlobals(asMap(options));
  }
  static Object agentRuntimeExportState(Object session, Object options) {
    if (!(session instanceof AxCodeSession active)) throw new RuntimeException("agent code session is not active");
    return active.exportState(asMap(options));
  }
  static Object agentRuntimeRestoreState(Object session, Object snapshot, Object options) {
    if (!(session instanceof AxCodeSession active)) throw new RuntimeException("agent code session is not active");
    return active.restoreState(snapshot, asMap(options));
  }
  static Object agentRuntimeClose(Object session) {
    if (!(session instanceof AxCodeSession active)) return Map.of("closed", true);
    Object result = active.close();
    return result == null ? Map.of("closed", true) : result;
  }
  static Object agentMemorySearch(Object state, Object searches, Object alreadyLoaded) {
    Map<String, Object> options = asMap(get(state, "options", Map.of()));
    Object scripted = options.getOrDefault("memory_search_results", options.get("memorySearchResults"));
    if (scripted instanceof Map<?, ?> map) {
      String joined = String.join("|", asList(searches).stream().map(String::valueOf).toList());
      if (map.containsKey(joined)) return map.get(joined);
      for (Object item : asList(searches)) if (map.containsKey(String.valueOf(item))) return map.get(String.valueOf(item));
      return map.containsKey("*") ? map.get("*") : List.of();
    }
    if (scripted instanceof List<?>) return scripted;
    return List.of();
  }
  static Object agentSkillSearch(Object state, Object searches) {
    Map<String, Object> options = asMap(get(state, "options", Map.of()));
    Object scripted = options.getOrDefault("skill_search_results", options.get("skillSearchResults"));
    if (scripted instanceof Map<?, ?> map) {
      String joined = String.join("|", asList(searches).stream().map(String::valueOf).toList());
      if (map.containsKey(joined)) return map.get(joined);
      List<Object> out = new ArrayList<>();
      for (Object item : asList(searches)) out.addAll(asList(map.get(String.valueOf(item))));
      if (!out.isEmpty()) return out;
      return map.containsKey("*") ? map.get("*") : List.of();
    }
    if (scripted instanceof List<?>) return scripted;
    return List.of();
  }
  static Object agentCallableInvoke(Object state, Object request, Object optionsArg) {
    Map<String, Object> options = asMap(get(state, "options", Map.of()));
    String qualified = String.valueOf(get(request, "qualified_name", get(request, "name", "")));
    Object scripted = options.getOrDefault("callable_results", options.get("callableResults"));
    if (scripted instanceof Map<?, ?> map) {
      Object requestName = String.valueOf(get(request, "name", ""));
      Object result = map.containsKey(qualified) ? map.get(qualified) : (map.containsKey(requestName) ? map.get(requestName) : map.get("*"));
      if (result != null) {
        if (result instanceof Map<?, ?> raw) {
          Map<String, Object> copied = new LinkedHashMap<>(asMap(raw));
          if (copied.containsKey("error")) {
            Map<String, Object> error = new LinkedHashMap<>();
            error.put("status", "error");
            error.put("error", copied.get("error"));
            return error;
          }
          copied.putIfAbsent("status", "ok");
          return copied;
        }
        return new LinkedHashMap<>(Map.of("status", "ok", "value", result));
      }
    }
    return new LinkedHashMap<>(Map.of("status", "error", "error", "unknown callable: " + qualified));
  }
  static Object axgenShouldContinueSteps(Object gen, Object calls) {
    Set<String> stops = new LinkedHashSet<>();
    for (Object item : asList(get(gen, "stop_functions", List.of()))) stops.add(String.valueOf(item));
    if (stops.isEmpty()) return true;
    for (Object raw : asList(calls)) {
      Map<String, Object> call = asMap(raw);
      Object fn = call.get("function");
      Object name = fn instanceof Map<?, ?> ? asMap(fn).get("name") : call.get("name");
      if (stops.contains(String.valueOf(name))) return false;
    }
    return true;
  }
  static Object streamEventContentParts(Object event) {
    if (event instanceof String s) return List.of(s);
    Map<String, Object> data = asMap(event);
    Object nested = data.get("data");
    if (nested instanceof Map<?, ?>) data = asMap(nested);
    Object type = data.get("type");
    if ("done".equals(type) || "message_stop".equals(type)) return List.of();
    if (data.get("results") != null) {
      List<Object> out = new ArrayList<>();
      for (Object result : asList(data.get("results"))) out.add(String.valueOf(asMap(result).getOrDefault("content", "")));
      return out;
    }
    return List.of(String.valueOf(data.getOrDefault("delta", data.getOrDefault("content_delta", data.getOrDefault("contentDelta", data.getOrDefault("text", data.getOrDefault("content", "")))))));
  }

// AXIR_CORE_JAVA_FUNCTIONS
}

class AxValidationError extends IllegalArgumentException {
  AxValidationError(String message) { super(message); }
}

class TemplateEngine {
  private static final Pattern TAG = Pattern.compile("\\{\\{\\s*([^}]+?)\\s*\\}\\}");
  private static final Pattern IDENT = Pattern.compile("^[A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)*$");
  private static final Pattern EQ = Pattern.compile("^([A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)*)\\s*===\\s*(?:'([^']*)'|\\\"([^\\\"]*)\\\")$");

  static List<Object> parse(String source, String context) {
    List<Map<String, Object>> tokens = tokenize(source);
    Map<String, Object> result = parseRange(tokens, source, context, 0, Set.of());
    if (result.get("terminator") != null) throw new TemplateError("Unexpected template terminator '" + result.get("terminator") + "' in " + context);
    return Core.asList(result.get("nodes"));
  }

  static String render(List<Object> nodes, Map<String, Object> vars, String source, String context) {
    StringBuilder out = new StringBuilder();
    for (Object item : nodes) {
      Map<String, Object> node = Core.asMap(item);
      String type = String.valueOf(node.get("type"));
      if ("text".equals(type)) out.append(node.getOrDefault("value", ""));
      else if ("var".equals(type)) {
        Object value = resolve(vars, String.valueOf(node.get("name")), source, context, Core.asInt(node.get("index")));
        if (!(value instanceof String || value instanceof Number || value instanceof Boolean)) throw new TemplateError(error(context, source, Core.asInt(node.get("index")), "Variable '" + node.get("name") + "' must be string, number, or boolean"));
        out.append(Core.display(value));
      } else if ("if".equals(type)) {
        String condition = String.valueOf(node.get("condition"));
        Matcher m = EQ.matcher(condition);
        boolean ok;
        if (m.matches()) ok = java.util.Objects.equals(resolve(vars, m.group(1), source, context, Core.asInt(node.get("index"))), m.group(2) != null ? m.group(2) : m.group(3));
        else {
          Object resolved = resolve(vars, condition, source, context, Core.asInt(node.get("index")));
          if (!(resolved instanceof Boolean)) throw new TemplateError(error(context, source, Core.asInt(node.get("index")), "Condition '" + condition + "' must be boolean"));
          ok = Boolean.TRUE.equals(resolved);
        }
        out.append(render(Core.asList(ok ? node.get("then") : node.get("else")), vars, source, context));
      }
    }
    return out.toString();
  }

  static List<Object> collect(List<Object> nodes) {
    Set<String> out = new LinkedHashSet<>();
    collectInto(nodes, out);
    List<Object> result = new ArrayList<>(out);
    result.sort(Comparator.comparing(String::valueOf));
    return result;
  }

  static Object validate(String source, String context, List<Object> required) {
    try {
      Set<String> present = new LinkedHashSet<>();
      for (Object item : collect(parse(source, context))) present.add(String.valueOf(item));
      for (Object variable : required) if (!present.contains(String.valueOf(variable))) return "must preserve template variable {{" + variable + "}}";
      return true;
    } catch (RuntimeException e) {
      return e.getMessage();
    }
  }

  private static List<Map<String, Object>> tokenize(String source) {
    List<Map<String, Object>> tokens = new ArrayList<>();
    Matcher m = TAG.matcher(source);
    int last = 0;
    while (m.find()) {
      if (m.start() > last) tokens.add(new LinkedHashMap<>(Map.of("type", "text", "value", source.substring(last, m.start()))));
      Map<String, Object> tag = new LinkedHashMap<>();
      tag.put("type", "tag"); tag.put("value", m.group(1).trim()); tag.put("index", m.start());
      tokens.add(tag);
      last = m.end();
    }
    if (last < source.length()) tokens.add(new LinkedHashMap<>(Map.of("type", "text", "value", source.substring(last))));
    return tokens;
  }

  private static Map<String, Object> parseRange(List<Map<String, Object>> tokens, String source, String context, int start, Set<String> terminators) {
    List<Object> nodes = new ArrayList<>();
    int i = start;
    while (i < tokens.size()) {
      Map<String, Object> token = tokens.get(i);
      if ("text".equals(token.get("type"))) { nodes.add(new LinkedHashMap<>(Map.of("type", "text", "value", token.get("value")))); i++; continue; }
      String tag = String.valueOf(token.get("value"));
      if (terminators.contains(tag)) return rangeResult(nodes, i, tag);
      int index = Core.asInt(token.get("index"));
      if (tag.startsWith("if ")) {
        String condition = tag.substring(3).trim();
        if (!IDENT.matcher(condition).matches() && !EQ.matcher(condition).matches()) throw new TemplateError(error(context, source, index, "Invalid if condition '" + condition + "'"));
        Map<String, Object> thenResult = parseRange(tokens, source, context, i + 1, Set.of("else", "/if"));
        Object terminator = thenResult.get("terminator");
        if (terminator == null) throw new TemplateError(error(context, source, index, "Unclosed 'if' block"));
        List<Object> elseNodes = new ArrayList<>();
        int next = Core.asInt(thenResult.get("index"));
        if ("else".equals(terminator)) {
          Map<String, Object> elseResult = parseRange(tokens, source, context, next + 1, Set.of("/if"));
          if (!"/if".equals(elseResult.get("terminator"))) throw new TemplateError(error(context, source, index, "Unclosed 'if' block"));
          elseNodes = Core.asList(elseResult.get("nodes"));
          next = Core.asInt(elseResult.get("index"));
        }
        Map<String, Object> node = new LinkedHashMap<>();
        node.put("type", "if"); node.put("condition", condition); node.put("then", thenResult.get("nodes")); node.put("else", elseNodes); node.put("index", index);
        nodes.add(node); i = next + 1; continue;
      }
      if ("else".equals(tag)) throw new TemplateError(error(context, source, index, "Unexpected 'else'"));
      if ("/if".equals(tag)) throw new TemplateError(error(context, source, index, "Unexpected '/if'"));
      if (tag.startsWith("!")) { i++; continue; }
      if (tag.startsWith("include ")) throw new TemplateError(error(context, source, index, "Unexpected 'include' directive at runtime (includes must be compiled)"));
      if (!IDENT.matcher(tag).matches()) throw new TemplateError(error(context, source, index, "Invalid tag '" + tag + "'"));
      Map<String, Object> node = new LinkedHashMap<>();
      node.put("type", "var"); node.put("name", tag); node.put("index", index);
      nodes.add(node); i++;
    }
    return rangeResult(nodes, i, null);
  }

  private static Map<String, Object> rangeResult(List<Object> nodes, int index, Object terminator) {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("nodes", nodes); out.put("index", index); out.put("terminator", terminator);
    return out;
  }

  private static Object resolve(Map<String, Object> vars, String path, String source, String context, int index) {
    Object current = vars;
    for (String part : path.split("\\.")) {
      if (!(current instanceof Map<?, ?> map) || !map.containsKey(part)) throw new TemplateError(error(context, source, index, "Missing template variable '" + path + "'"));
      current = map.get(part);
    }
    return current;
  }

  private static void collectInto(List<Object> nodes, Set<String> out) {
    for (Object item : nodes) {
      Map<String, Object> node = Core.asMap(item);
      if ("var".equals(node.get("type"))) out.add(String.valueOf(node.get("name")));
      else if ("if".equals(node.get("type"))) {
        Matcher m = EQ.matcher(String.valueOf(node.get("condition")));
        out.add(m.matches() ? m.group(1) : String.valueOf(node.get("condition")));
        collectInto(Core.asList(node.get("then")), out);
        collectInto(Core.asList(node.get("else")), out);
      }
    }
  }

  private static String error(String context, String source, int index, String message) {
    int line = 1, col = 1;
    for (int i = 0; i < index && i < source.length(); i++) { if (source.charAt(i) == '\n') { line++; col = 1; } else col++; }
    return context + ":" + line + ":" + col + " " + message;
  }
}

class TemplateError extends IllegalArgumentException {
  TemplateError(String message) { super(message); }
}

class PromptRuntime {
  static final String BT = String.valueOf((char) 96);
  static final String DEFAULT_DSPY_TEMPLATE =
    "<identity>\n{{ identityText }}\n</identity>{{ if hasFunctions }}\n\n" +
    "<available_functions>\n**Available Functions**: You can call the following functions to complete the task:\n\n{{ functionsList }}\n\n" +
    "## Function Call Instructions\n- Complete the task, using the functions defined earlier in this prompt.\n- Output fields should only be generated after all functions have been called.\n- Use the function results to generate the output fields.\n</available_functions>{{ /if }}\n\n" +
    "<input_fields>\n{{ inputFieldsSection }}\n</input_fields>{{ if hasOutputFields }}\n\n<output_fields>\n{{ outputFieldsSection }}\n</output_fields>{{ /if }}\n" +
    "{{ if hasTaskDefinition }}\n\n<task_definition>\n{{ taskDefinitionText }}\n</task_definition>{{ /if }}\n\n<formatting_rules>\n{{ if hasStructuredOutputFunction }}\n" +
    "Return the complete output by calling " + BT + "{{ structuredOutputFunctionName }}" + BT + ".\n{{ else }}{{ if hasComplexFields }}\nReturn valid JSON matching <output_fields>.\n{{ else }}\nReturn one " + BT + "field name: value" + BT + " pair per line for the required output fields only.\n{{ /if }}{{ /if }}Above rules override later instructions.\n\n</formatting_rules>\n{{ if hasExampleDemonstrations }}\n\n## Example Demonstrations\nThe following User/Assistant turns are examples only until --- END OF EXAMPLES ---, not context for the current task.\n{{ /if }}\n";

  static String structured(AxSignature sig, Map<String, Object> values, List<Object> functions, Map<String, Object> options) {
    boolean complex = sig.hasComplexFields();
    String task = taskDefinition(sig);
    List<Map<String, Object>> funcs = functionDescriptors(functions);
    Map<String, Object> vars = new LinkedHashMap<>();
    vars.put("hasFunctions", !funcs.isEmpty());
    vars.put("hasTaskDefinition", !task.isEmpty());
    vars.put("hasExampleDemonstrations", Core.truthy(options.getOrDefault("has_example_demonstrations", options.get("hasExampleDemonstrations"))));
    vars.put("hasOutputFields", !complex);
    vars.put("hasComplexFields", complex);
    vars.put("hasStructuredOutputFunction", complex && options.get("structured_output_function_name") != null);
    vars.put("identityText", identity(sig, values));
    vars.put("taskDefinitionText", task);
    vars.put("functionsList", funcs.isEmpty() ? "" : renderFunctions(funcs));
    vars.put("inputFieldsSection", inputSection(sig, values));
    vars.put("outputFieldsSection", complex ? "" : outputSection(sig));
    vars.put("structuredOutputFunctionName", options.getOrDefault("structured_output_function_name", ""));
    String source = options.get("custom_template") == null ? DEFAULT_DSPY_TEMPLATE : String.valueOf(options.get("custom_template"));
    String context = options.get("custom_template") == null ? "template:dsp/dspy.md" : "inline-template";
    return String.valueOf(Core.render_template_content(source, vars, context)).trim();
  }

  static Object userContent(AxSignature sig, Map<String, Object> values) {
    List<Map<String, Object>> parts = new ArrayList<>();
    for (Field field : inputFieldsForValues(sig, values)) {
      Object value = values.get(field.name);
      if (!provided(value)) {
        if (field.optional || field.internal) continue;
        throw new IllegalArgumentException("Value for input field '" + field.name + "' is required.");
      }
      if (field.type != null && List.of("image", "audio", "file", "url").contains(field.type.name) && value instanceof Map<?, ?> map) {
        parts.add(new LinkedHashMap<>(Map.of("type", "text", "text", field.title + ": \n")));
        Map<String, Object> media = new LinkedHashMap<>(Core.asMap(map));
        media.putIfAbsent("type", field.type.name);
        parts.add(media);
      } else {
        String rendered = value instanceof String ? String.valueOf(value) : Json.pretty(value);
        Map<String, Object> part = new LinkedHashMap<>(Map.of("type", "text", "text", field.title + ": " + rendered + "\n"));
        if (field.cached) part.put("cache", true);
        parts.add(part);
      }
    }
    boolean allText = true;
    for (Map<String, Object> part : parts) if (!"text".equals(part.get("type")) || Boolean.TRUE.equals(part.get("cache"))) allText = false;
    if (allText) {
      List<String> text = new ArrayList<>();
      for (Map<String, Object> part : parts) text.add(String.valueOf(part.getOrDefault("text", "")));
      return String.join("\n", text);
    }
    return parts;
  }

  static List<Field> inputFieldsForValues(AxSignature sig, Map<String, Object> values) {
    List<Field> fields = new ArrayList<>(sig.inputs);
    fields.sort(Comparator.comparing(f -> f.cached ? 0 : 1));
    List<Field> out = new ArrayList<>();
    for (Field field : fields) if (!field.optional || provided(values.get(field.name))) out.add(field);
    return out;
  }
  static boolean provided(Object value) { return value != null && (!(value instanceof String s) || !s.isEmpty()) && (!(value instanceof List<?> l) || !l.isEmpty()); }
  static String identity(AxSignature sig, Map<String, Object> values) { return "You will be provided with the following fields: " + descFields(inputFieldsForValues(sig, values)) + ". Your task is to generate new fields: " + descFields(sig.outputs) + "."; }
  static String descFields(List<Field> fields) { List<String> out = new ArrayList<>(); for (Field f : fields) out.add(BT + f.title + BT); return String.join(", ", out); }
  static String taskDefinition(AxSignature sig) { return sig.description == null || sig.description.isBlank() ? "" : formatFieldRefs(formatDescription(sig.description), fieldMap(sig)); }
  static String inputSection(AxSignature sig, Map<String, Object> values) { return "**Input Fields**: The following fields will be provided to you:\n\n" + renderInputFields(inputFieldsForValues(sig, values), fieldMap(sig)); }
  static String outputSection(AxSignature sig) { return "**Output Fields**: You must generate the following fields:\n\n" + renderOutputFields(sig.outputs, fieldMap(sig)); }
  static Map<String, String> fieldMap(AxSignature sig) { Map<String, String> out = new LinkedHashMap<>(); for (Field f : sig.inputs) out.put(f.name, f.title); for (Field f : sig.outputs) out.put(f.name, f.title); return out; }
  static String formatDescription(String text) { String v = text == null ? "" : text.trim(); if (v.isEmpty()) return ""; return v.substring(0, 1).toUpperCase() + v.substring(1) + (v.endsWith(".") ? "" : "."); }
  static String formatFieldRefs(String desc, Map<String, String> names) { String out = desc; List<String> keys = new ArrayList<>(names.keySet()); keys.sort((a, b) -> Integer.compare(b.length(), a.length())); for (String key : keys) { String title = names.get(key); out = out.replace(BT + key + BT, BT + title + BT).replace("\"" + key + "\"", "\"" + title + "\"").replace("'" + key + "'", "'" + title + "'").replace("[" + key + "]", "[" + title + "]").replace("(" + key + ")", "(" + title + ")").replaceAll("\\$" + Pattern.quote(key) + "\\b", BT + title + BT); } return out; }
  static String fieldTypeText(FieldType t) {
    String base = switch (t.name) {
      case "number" -> "number";
      case "boolean" -> "boolean (true or false)";
      case "date" -> "date (YYYY-MM-DD, e.g. 2024-05-09)";
      case "dateRange" -> "date range ({ \"start\": \"YYYY-MM-DD\", \"end\": \"YYYY-MM-DD\" }, e.g. {\"start\":\"2024-05-09\",\"end\":\"2024-05-12\"})";
      case "datetime" -> "datetime (ISO 8601 with timezone, e.g. 2024-05-09T14:30:00Z or 2024-05-09T14:30:00-07:00)";
      case "datetimeRange" -> "datetime range ({ \"start\": ISO datetime, \"end\": ISO datetime }, e.g. {\"start\":\"2024-05-09T14:30:00Z\",\"end\":\"2024-05-09T15:30:00Z\"})";
      case "json" -> "JSON object";
      case "class" -> "classification class";
      case "code" -> "code";
      case "file" -> "file (with filename, mimeType, and data)";
      case "audio" -> "speech script (plain text to synthesize as audio)";
      case "url" -> "URL (string or object with url, title, description)";
      case "object" -> t.fields == null || t.fields.isEmpty() ? "object" : "object " + objectStructure(t.fields);
      default -> "string";
    };
    return t.array ? "json array of " + base + " items" : base;
  }
  static String objectStructure(Map<String, Object> fields) { List<String> out = new ArrayList<>(); for (Map.Entry<String, Object> e : fields.entrySet()) { Field f = e.getValue() instanceof Field field ? field : new Field(e.getKey(), (FieldType) e.getValue(), null, false, false, false); out.add(e.getKey() + (f.optional ? "?" : "") + ": " + fieldTypeText(f.type)); } return "{ " + String.join(", ", out) + " }"; }
  static String renderInputFields(List<Field> fields, Map<String, String> names) { List<String> rows = new ArrayList<>(); for (Field f : fields) rows.add((f.title + ":" + (f.description == null ? "" : " " + formatFieldRefs(formatDescription(f.description), names))).trim()); return String.join("\n", rows); }
  static String renderOutputFields(List<Field> fields, Map<String, String> names) { List<String> rows = new ArrayList<>(); for (Field f : fields) { String typeText = fieldTypeText(f.type); String req = f.optional ? "Only include this " + typeText + " field if its value is available" : "This " + typeText + " field must be included"; String desc = ""; if (f.description != null) desc = " " + formatFieldRefs("class".equals(f.type.name) ? f.description : formatDescription(f.description), names); if (f.type.options != null) desc += (desc.isEmpty() ? "" : ". ") + "Allowed values: " + String.join(", ", f.type.options); rows.add((f.title + ": (" + req + ")" + desc).trim()); } return String.join("\n", rows); }
  static List<Map<String, Object>> functionDescriptors(List<Object> functions) { List<Map<String, Object>> out = new ArrayList<>(); for (Object fn : functions) { if (fn instanceof Tool t) out.add(Map.of("name", t.name, "description", t.description)); else if (fn instanceof Map<?, ?> map) out.add(Map.of("name", Core.asMap(map).get("name"), "description", Core.asMap(map).getOrDefault("description", ""))); } return out; }
  static String renderFunctions(List<Map<String, Object>> funcs) { List<String> out = new ArrayList<>(); for (Map<String, Object> fn : funcs) out.add("- " + BT + fn.get("name") + BT + ": " + formatDescription(String.valueOf(fn.getOrDefault("description", "")))); return String.join("\n", out); }
}
`

const javaConformance = `package dev.ax;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class Conformance {
  static final class FixtureError extends AssertionError {
    FixtureError(String message) { super(message); }
  }

  static final class FakeAIService extends AxBaseAI {
    final List<Object> responses;
    final List<Object> streamEvents;
    final List<Map<String, Object>> requests = new ArrayList<>();
    int chatCalls;

    FakeAIService(List<Object> responses, List<Object> streamEvents) {
      super("fake", "fake-chat", "fake-embed", Map.of(), Map.of());
      this.responses = new ArrayList<>(responses);
      this.streamEvents = new ArrayList<>(streamEvents);
    }

    protected Map<String, Object> doChat(Map<String, Object> request, Map<String, Object> options) {
      chatCalls++;
      requests.add(new LinkedHashMap<>(request));
      if (responses.isEmpty()) throw new RuntimeException("fake client exhausted");
      return Core.legacyResponseToChatResponse(Core.asMap(responses.remove(0)));
    }

    protected Map<String, Object> doEmbed(Map<String, Object> request, Map<String, Object> options) {
      requests.add(new LinkedHashMap<>(request));
      if (responses.isEmpty()) throw new RuntimeException("fake client exhausted");
      return Core.asMap(responses.remove(0));
    }

    public Iterable<Map<String, Object>> stream(Map<String, Object> request) {
      requests.add(new LinkedHashMap<>(request));
      List<Map<String, Object>> out = new ArrayList<>();
      for (Object event : streamEvents) out.add(Core.asMap(event));
      return out;
    }
  }

  static final class FakeTransport implements OpenAICompatibleClient.Transport {
    final List<Object> responses;
    final List<Map<String, Object>> requests = new ArrayList<>();
    FakeTransport(List<Object> responses) { this.responses = new ArrayList<>(responses); }
    public Object call(Map<String, Object> request) {
      requests.add(new LinkedHashMap<>(request));
      if (responses.isEmpty()) throw new RuntimeException("fake transport exhausted");
      return responses.remove(0);
    }
  }

  static final class FakeOptimizerEngine implements OptimizerEngine {
    final Map<String, Object> response;
    final List<Map<String, Object>> requests = new ArrayList<>();
    final List<Map<String, Object>> evaluations = new ArrayList<>();
    final List<Map<String, Object>> transcripts = new ArrayList<>();

    FakeOptimizerEngine(Object response) {
      this.response = new LinkedHashMap<>(Core.asMap(response));
    }

    public String name() { return "fake"; }
    public String version() { return "1"; }

    public Map<String, Object> optimize(Map<String, Object> request) {
      requests.add(new LinkedHashMap<>(request));
      return new LinkedHashMap<>(response);
    }

    public Map<String, Object> optimize(Map<String, Object> request, OptimizerEvaluator evaluator) {
      requests.add(new LinkedHashMap<>(request));
      if (evaluator != null && response.containsKey("evaluate")) {
        for (Object raw : Core.asList(response.get("evaluate"))) {
          Map<String, Object> step = Core.asMap(raw);
          Map<String, Object> candidate = Core.asMap(step.getOrDefault("component_map", step.getOrDefault("componentMap", Map.of())));
          Map<String, Object> evalOptions = Core.asMap(step.getOrDefault("options", Map.of()));
          Map<String, Object> result = evaluator.evaluate(
            candidate,
            evalOptions
          );
          Map<String, Object> evidence = Core.asMap(Core._build_optimizer_evidence_batch(result, Core.asList(request.getOrDefault("components", List.of()))));
          evaluations.add(result);
          transcripts.add(new LinkedHashMap<>(Map.of("candidateMap", candidate, "options", evalOptions, "result", result, "evidence", evidence)));
        }
      }
      if (evaluator != null && response.containsKey("referenceCandidates")) {
        Map<String, Object> bestMap = new LinkedHashMap<>();
        Double bestScore = null;
        for (Object raw : Core.asList(response.get("referenceCandidates"))) {
          Map<String, Object> step = Core.asMap(raw);
          Map<String, Object> candidate = Core.asMap(step.getOrDefault("component_map", step.getOrDefault("componentMap", Map.of())));
          Map<String, Object> evalOptions = Core.asMap(step.getOrDefault("options", Map.of()));
          Map<String, Object> result = evaluator.evaluate(candidate, evalOptions);
          Map<String, Object> evidence = Core.asMap(Core._build_optimizer_evidence_batch(result, Core.asList(request.getOrDefault("components", List.of()))));
          evaluations.add(result);
          transcripts.add(new LinkedHashMap<>(Map.of("candidateMap", candidate, "options", evalOptions, "result", result, "evidence", evidence)));
          double score = Core.asDouble(result.getOrDefault("avg", 0));
          if (bestScore == null || score > bestScore) {
            bestScore = score;
            bestMap = new LinkedHashMap<>(candidate);
          }
        }
        return new LinkedHashMap<>(Map.of("componentMap", bestMap, "metadata", Map.of("referenceEngine", true, "evaluations", transcripts)));
      }
      return new LinkedHashMap<>(response);
    }
  }

  static final class FakeCodeRuntime implements AxCodeRuntime {
    final List<Object> script;
    final List<FakeCodeSession> sessions = new ArrayList<>();
    final List<String> executed = new ArrayList<>();
    final String language;
    final String usageInstructions;

    FakeCodeRuntime(List<Object> script) {
      this(script, "JavaScript", "");
    }

    FakeCodeRuntime(List<Object> script, String language, String usageInstructions) {
      this.script = new ArrayList<>(script == null ? List.of() : script);
      this.language = language == null || language.isBlank() ? "JavaScript" : language;
      this.usageInstructions = usageInstructions == null ? "" : usageInstructions;
    }

    public String language() { return language; }
    public String getUsageInstructions() { return usageInstructions; }

    public AxCodeSession createSession(Map<String, Object> globals, Map<String, Object> options) {
      FakeCodeSession session = new FakeCodeSession(this, globals);
      sessions.add(session);
      return session;
    }
  }

  static final class FakeCodeSession implements AxCodeSession {
    final FakeCodeRuntime runtime;
    Map<String, Object> globals;
    boolean closed;

    FakeCodeSession(FakeCodeRuntime runtime, Map<String, Object> globals) {
      this.runtime = runtime;
      this.globals = new LinkedHashMap<>(globals == null ? Map.of() : globals);
    }

    public Object execute(String code, Map<String, Object> options) {
      if (closed) return new LinkedHashMap<>(Map.of("is_error", true, "error_category", "session_closed", "error", "session closed"));
      if (runtime.script.isEmpty()) throw new RuntimeException("fake runtime exhausted");
      Map<String, Object> step = Core.asMap(runtime.script.remove(0));
      Object expected = step.get("expected_code");
      if (expected != null && !String.valueOf(expected).equals(code)) throw new RuntimeException("expected code " + expected + ", got " + code);
      runtime.executed.add(code);
      globals.putAll(Core.asMap(step.get("bindings_patch")));
      if (Boolean.TRUE.equals(step.get("close_before_result"))) closed = true;
      return step.getOrDefault("result", new LinkedHashMap<>(Map.of("kind", "result", "result", new LinkedHashMap<>(globals))));
    }

    public Object inspectGlobals(Map<String, Object> options) {
      return new LinkedHashMap<>(globals);
    }

    public Object exportState(Map<String, Object> options) {
      return new LinkedHashMap<>(Map.of("globals", new LinkedHashMap<>(globals), "closed", closed));
    }

    public Object restoreState(Object snapshot, Map<String, Object> options) {
      Map<String, Object> snap = Core.asMap(snapshot);
      globals = new LinkedHashMap<>(Core.asMap(snap.get("globals")));
      closed = Boolean.TRUE.equals(snap.get("closed"));
      return exportState(options);
    }

    public Object close() {
      closed = true;
      return new LinkedHashMap<>(Map.of("closed", true));
    }
  }

  public static void main(String[] args) throws Exception {
    if (args.length == 0) throw new IllegalArgumentException("usage: java dev.ax.Conformance <fixture-or-dir>...");
    for (String arg : args) {
      for (Path path : expand(Path.of(arg))) {
        Map<String, Object> fixture = Core.asMap(Json.parse(Files.readString(path)));
        run(fixture);
        System.out.println("ok " + fixture.getOrDefault("name", path.getFileName().toString()));
      }
    }
  }

  static List<Path> expand(Path path) throws Exception {
    if (!Files.isDirectory(path)) return List.of(path);
    try (var stream = Files.list(path)) {
      return stream.filter(p -> p.toString().endsWith(".json")).sorted().toList();
    }
  }

  static void run(Map<String, Object> fixture) {
    String kind = String.valueOf(fixture.getOrDefault("kind", "forward"));
    switch (kind) {
      case "signature_error" -> runSignatureError(fixture);
      case "signature" -> assertEqual(signaturePayload(buildSignature(fixture)), fixture.get("expected_signature"), "signature");
      case "json_schema" -> runJsonSchema(fixture);
      case "validate_value" -> runValidateValue(fixture);
      case "validate_output" -> runValidateOutput(fixture);
      case "strip_internal" -> runStripInternal(fixture);
      case "prompt" -> runPrompt(fixture);
      case "template" -> assertEqual(Core.render_template_content(fixture.get("template"), fixture.getOrDefault("vars", Map.of()), fixture.getOrDefault("context", "fixture-template")), fixture.getOrDefault("expected_output", ""), "template output");
      case "template_error" -> runTemplateError(fixture);
      case "template_validate" -> assertEqual(Core.validate_prompt_template_syntax(fixture.get("template"), fixture.getOrDefault("context", "fixture-template"), fixture.getOrDefault("required_variables", List.of())), fixture.getOrDefault("expected_result", true), "template validation");
      case "stream" -> assertEqual(Core.fold_stream(fixture.getOrDefault("stream_events", List.of())), fixture.getOrDefault("expected_folded", ""), "stream fold");
      case "forward" -> runForward(fixture);
      case "ai_chat" -> runAIChat(fixture);
      case "ai_embed" -> runAIEmbed(fixture);
      case "ai_stream" -> runAIStream(fixture);
      case "ai_error" -> runAIError(fixture);
      case "ai_unsupported" -> runAIUnsupported(fixture);
      case "agent_forward" -> runAgentForward(fixture);
      case "agent_runtime_policy" -> runAgentRuntimePolicy(fixture);
      case "agent_runtime_session" -> runAgentRuntimeSession(fixture);
      case "program_contract" -> runProgramContract(fixture);
      case "flow" -> runFlow(fixture);
      case "optimize" -> runOptimize(fixture);
      default -> throw new FixtureError("unknown fixture kind " + kind);
    }
  }

  static void runSignatureError(Map<String, Object> fixture) {
    try {
      buildSignature(fixture);
    } catch (RuntimeException e) {
      String expected = (String) fixture.get("expected_error_contains");
      if (expected != null && !String.valueOf(e.getMessage()).contains(expected)) throw new FixtureError("expected error containing " + expected + ", got " + e);
      return;
    }
    throw new FixtureError("expected signature construction to fail");
  }

  static void runJsonSchema(Map<String, Object> fixture) {
    AxSignature sig = buildSignature(fixture);
    Object fields = "inputs".equals(fixture.getOrDefault("target", "outputs")) ? sig.inputs : sig.outputs;
    Object schema = Core.to_json_schema(fields, fixture.getOrDefault("schema_title", "Schema"), fixture.getOrDefault("schema_options", Map.of()));
    assertEqual(schema, fixture.get("expected_schema"), "json schema");
  }

  static void runValidateValue(Map<String, Object> fixture) {
    Field field = fieldFromSpec(Core.asMap(fixture.getOrDefault("field", Map.of()))).toField(String.valueOf(fixture.getOrDefault("field_name", "value")));
    expectMaybeError(() -> Core.validate_value(field, fixture.get("value"), null), fixture);
  }

  static void runValidateOutput(Map<String, Object> fixture) {
    AxSignature sig = buildSignature(fixture);
    Object result = expectMaybeError(() -> Core.validate_output(sig.outputs, fixture.getOrDefault("values", Map.of())), fixture);
    if (!fixture.containsKey("expected_error_contains")) assertEqual(result, fixture.getOrDefault("expected_values", fixture.getOrDefault("values", Map.of())), "validated output");
  }

  static void runStripInternal(Map<String, Object> fixture) {
    AxSignature sig = buildSignature(fixture);
    assertEqual(Core.strip_internal(sig.outputs, fixture.getOrDefault("values", Map.of())), fixture.get("expected_output"), "strip internal");
  }

  static void runPrompt(Map<String, Object> fixture) {
    AxSignature sig = buildSignature(fixture);
    ToolBuild tools = buildTools(Core.asList(fixture.getOrDefault("tools", List.of())));
    Map<String, Object> options = Core.asMap(fixture.getOrDefault("options", Map.of()));
    PromptTemplate prompt = new PromptTemplate(
      sig,
      tools.tools,
      (String) fixture.getOrDefault("structured_output_function_name", options.getOrDefault("structured_output_function_name", options.get("structuredOutputFunctionName"))),
      (String) fixture.getOrDefault("custom_template", options.getOrDefault("custom_template", options.get("customTemplate")))
    );
    if (fixture.get("instruction") != null) prompt.setInstruction(String.valueOf(fixture.get("instruction")));
    Object messages = prompt.render(Core.asMap(fixture.getOrDefault("input", fixture.getOrDefault("values", Map.of()))));
    for (Object item : Core.asList(fixture.getOrDefault("expected_prompt_contains", List.of()))) {
      if (!Json.stringify(messages).contains(String.valueOf(item))) throw new FixtureError("prompt missing " + item + ": " + messages);
    }
    if (fixture.containsKey("expected_messages")) assertEqual(messages, fixture.get("expected_messages"), "messages");
  }

  static void runTemplateError(Map<String, Object> fixture) {
    try {
      if ("validate".equals(fixture.get("operation"))) {
        Object result = Core.validate_prompt_template_syntax(fixture.get("template"), fixture.getOrDefault("context", "fixture-template"), fixture.getOrDefault("required_variables", List.of()));
        if (!Boolean.TRUE.equals(result)) throw new RuntimeException(String.valueOf(result));
      } else {
        Core.render_template_content(fixture.get("template"), fixture.getOrDefault("vars", Map.of()), fixture.getOrDefault("context", "fixture-template"));
      }
    } catch (RuntimeException e) {
      String expected = (String) fixture.get("expected_error_contains");
      if (expected != null && !String.valueOf(e.getMessage()).contains(expected)) throw new FixtureError("expected error containing " + expected + ", got " + e);
      return;
    }
    throw new FixtureError("expected template operation to fail");
  }

  static void runForward(Map<String, Object> fixture) {
    AxSignature sig = buildSignature(fixture);
    ToolBuild toolBuild = buildTools(Core.asList(fixture.getOrDefault("tools", List.of())));
    Map<String, Object> options = new LinkedHashMap<>(Core.asMap(fixture.getOrDefault("options", Map.of())));
    options.put("functions", toolBuild.tools);
    AxGen gen = new AxGen(sig, options);
    if (fixture.containsKey("examples")) gen.setExamples(Core.asMapList(fixture.get("examples")));
    if (fixture.containsKey("demos")) gen.setDemos(Core.asMapList(fixture.get("demos")));
    for (Object item : Core.asList(fixture.getOrDefault("assertions", List.of()))) gen.addAssertion(Core.asMap(item));
    for (Object item : Core.asList(fixture.getOrDefault("field_processors", fixture.getOrDefault("fieldProcessors", List.of())))) {
      Map<String, Object> processor = Core.asMap(item);
      gen.addFieldProcessor(String.valueOf(processor.get("field")), String.valueOf(processor.getOrDefault("processor", processor.get("op"))));
    }
    if (fixture.containsKey("stop_functions") || fixture.containsKey("stopFunctions")) {
      List<String> names = new ArrayList<>();
      for (Object item : Core.asList(fixture.getOrDefault("stop_functions", fixture.getOrDefault("stopFunctions", List.of())))) names.add(String.valueOf(item));
      gen.setStopFunctions(names);
    }
    FakeAIService client = new FakeAIService(Core.asList(fixture.getOrDefault("responses", List.of())), Core.asList(fixture.getOrDefault("stream_events", List.of())));
    Object output = expectMaybeError(() -> gen.forward(client, Core.asMap(fixture.getOrDefault("input", Map.of())), Core.asMap(fixture.getOrDefault("forward_options", Map.of()))), fixture);
    if (!fixture.containsKey("expected_error_contains") && fixture.containsKey("expected_output")) assertEqual(output, fixture.get("expected_output"), "forward output");
    if (fixture.containsKey("expected_request_count") && client.requests.size() != Core.asInt(fixture.get("expected_request_count"))) throw new FixtureError("expected request count mismatch");
    if (Boolean.TRUE.equals(fixture.getOrDefault("expect_chat_path", true)) && client.chatCalls == 0) throw new FixtureError("expected AxGen to use AxAIService.chat()");
    if (fixture.containsKey("expected_request")) assertSubset(client.requests.get(0), fixture.get("expected_request"), "request");
    if (fixture.containsKey("expected_request_contains")) {
      String text = Json.stringify(client.requests);
      for (Object item : Core.asList(fixture.get("expected_request_contains"))) if (!text.contains(String.valueOf(item))) throw new FixtureError("request missing " + item + ": " + text);
    }
    if (fixture.containsKey("expected_tool_calls")) assertEqual(toolBuild.calls, fixture.get("expected_tool_calls"), "tool calls");
	    if (fixture.containsKey("expected_trace")) {
	      if (gen.getTraces().isEmpty()) throw new FixtureError("expected trace but none was recorded");
	      assertSubset(gen.getTraces().get(gen.getTraces().size() - 1), fixture.get("expected_trace"), "trace");
	    }
	    if (fixture.containsKey("expected_memory_history_subset")) assertListSubset(gen.getMemory().history(), fixture.get("expected_memory_history_subset"), "memory history");
	    if (fixture.containsKey("expected_chat_log_subset")) assertListSubset(gen.getChatLog(), fixture.get("expected_chat_log_subset"), "chat log");
	    if (fixture.containsKey("expected_function_traces_subset")) assertListSubset(gen.getFunctionCallTraces(), fixture.get("expected_function_traces_subset"), "function call traces");
	    if (fixture.containsKey("expected_chat_prompt")) assertEqual(client.requests.get(0).get("chat_prompt"), fixture.get("expected_chat_prompt"), "chat prompt");
	    if (fixture.containsKey("expected_chat_prompt_contains")) {
	      String promptText = Json.stringify(client.requests.get(0).get("chat_prompt"));
	      for (Object item : Core.asList(fixture.get("expected_chat_prompt_contains"))) if (!promptText.contains(String.valueOf(item))) throw new FixtureError("chat prompt missing " + item + ": " + promptText);
	    }
	  }

  static AxFlow buildFlow(Map<String, Object> fixture) {
    AxFlow fl = Ax.flow(Core.asMap(fixture.getOrDefault("flow_options", Map.of("id", fixture.getOrDefault("program_id", "root.flow")))));
    for (Object rawStep : Core.asList(fixture.getOrDefault("steps", List.of()))) {
      Map<String, Object> step = Core.asMap(rawStep);
      String kind = String.valueOf(step.getOrDefault("kind", "execute"));
      String name = String.valueOf(step.get("name"));
      if ("parallel".equals(kind) || "parallelMerge".equals(kind)) {
        fl.parallel(List.of(Map.of(
          "kind", kind,
          "name", name,
          "options", Core.asMap(step.getOrDefault("options", Map.of()))
        )));
        continue;
      }
      if ("map".equals(kind)) {
        Object output = step.getOrDefault("output", Map.of());
        fl.map(name, state -> output, Core.asMap(step.getOrDefault("options", Map.of())));
        continue;
      }
      AxProgram program;
      if ("flow".equals(step.get("program"))) {
        Map<String, Object> nestedFixture = new LinkedHashMap<>();
        nestedFixture.put("flow_options", step.getOrDefault("flow_options", Map.of("id", step.getOrDefault("program_id", "root." + name))));
        nestedFixture.put("steps", step.getOrDefault("steps", List.of()));
        nestedFixture.put("returns", step.getOrDefault("returns", Map.of()));
        nestedFixture.put("signature", step.getOrDefault("signature", fixture.getOrDefault("signature", "question:string -> answer:string")));
        program = buildFlow(nestedFixture);
      } else if ("agent".equals(step.get("program"))) {
        program = Ax.agent(String.valueOf(step.getOrDefault("signature", fixture.getOrDefault("signature", "question:string -> answer:string"))), Core.asMap(step.getOrDefault("options", Map.of())));
      } else {
        program = new AxGen(AxSignature.create(String.valueOf(step.getOrDefault("signature", fixture.getOrDefault("signature", "question:string -> answer:string")))), Core.asMap(step.getOrDefault("options", Map.of())));
      }
      Map<String, Object> stepOptions = new LinkedHashMap<>(Core.asMap(step.getOrDefault("forward_options", Map.of())));
      stepOptions.putAll(Core.asMap(step.getOrDefault("options", Map.of())));
      if ("derive".equals(kind)) fl.derive(name, program, stepOptions);
      else fl.execute(name, program, stepOptions);
    }
    if (fixture.containsKey("returns")) fl.returns(Core.asMap(fixture.getOrDefault("returns", Map.of())));
    if (fixture.containsKey("demos")) fl.setDemos(fixture.get("demos"));
    return fl;
  }

  static void runProgramContract(Map<String, Object> fixture) {
    Object program = "flow".equals(fixture.get("program")) ? buildFlow(fixture) : new AxGen(AxSignature.create(String.valueOf(fixture.getOrDefault("signature", "question:string -> answer:string"))), Core.asMap(fixture.getOrDefault("options", Map.of())));
    Object components = program instanceof AxFlow fl ? fl.getOptimizableComponents() : ((AxGen) program).getOptimizableComponents();
    if (fixture.containsKey("expected_component_ids")) {
      List<Object> ids = new ArrayList<>();
      for (Object component : Core.asList(components)) ids.add(Core.asMap(component).get("id"));
      assertEqual(ids, fixture.get("expected_component_ids"), "program component ids");
    }
    if (fixture.containsKey("expected_components_subset")) assertListSubset(Core.asList(components), fixture.get("expected_components_subset"), "program components");
  }

  static void runFlow(Map<String, Object> fixture) {
    try {
      AxFlow fl = buildFlow(fixture);
      if ("cache_key".equals(fixture.get("operation"))) {
        List<Object> keys = new ArrayList<>();
        for (Object item : Core.asList(fixture.getOrDefault("cache_key_inputs", List.of()))) keys.add(Core._flow_cache_key(item));
        if (Boolean.TRUE.equals(fixture.get("expected_cache_keys_equal")) && new java.util.HashSet<>(keys).size() != 1) throw new FixtureError("expected equal flow cache keys, got " + keys);
        if (Boolean.TRUE.equals(fixture.get("expected_cache_keys_distinct")) && new java.util.HashSet<>(keys).size() != keys.size()) throw new FixtureError("expected distinct flow cache keys, got " + keys);
        return;
      }
      if (fixture.containsKey("expected_plan")) assertEqual(fl.getPlan(), fixture.get("expected_plan"), "flow plan");
      if (fixture.containsKey("expected_plan_subset")) assertListSubset(fl.getPlan(), fixture.get("expected_plan_subset"), "flow plan");
      if ("plan".equals(fixture.get("operation"))) return;
      FakeAIService client = new FakeAIService(Core.asList(fixture.getOrDefault("responses", List.of())), Core.asList(fixture.getOrDefault("stream_events", List.of())));
      Map<String, Object> forwardOptions = new LinkedHashMap<>(Core.asMap(fixture.getOrDefault("forward_options", Map.of())));
      if (fixture.containsKey("cache_seed_value")) {
        Map<String, Object> cacheStore = Core.asMap(forwardOptions.getOrDefault("cache_store", new LinkedHashMap<>()));
        cacheStore.put(String.valueOf(Core._flow_cache_key(fixture.getOrDefault("input", Map.of()))), fixture.get("cache_seed_value"));
        forwardOptions.put("cache_store", cacheStore);
      }
      Object output = fl.forward(client, Core.asMap(fixture.getOrDefault("input", Map.of())), forwardOptions);
      if (fixture.containsKey("expected_output")) assertEqual(output, fixture.get("expected_output"), "flow output");
      if (fixture.containsKey("expected_request_count") && client.requests.size() != Core.asInt(fixture.get("expected_request_count"))) throw new FixtureError("expected request count mismatch");
      if (fixture.containsKey("expected_request_contains")) {
        String text = Json.stringify(client.requests);
        for (Object item : Core.asList(fixture.get("expected_request_contains"))) if (!text.contains(String.valueOf(item))) throw new FixtureError("flow request missing " + item + ": " + text);
      }
      if (fixture.containsKey("expected_chat_log_subset")) assertListSubset(fl.getChatLog(), fixture.get("expected_chat_log_subset"), "flow chat log");
      if (fixture.containsKey("expected_trace_kinds")) {
        List<Object> kinds = new ArrayList<>();
        for (Map<String, Object> event : fl.getTraces()) kinds.add(event.get("kind"));
        assertEqual(kinds, fixture.get("expected_trace_kinds"), "flow trace kinds");
      }
      if (fixture.containsKey("expected_trace_subset")) assertListSubset(fl.getTraces(), fixture.get("expected_trace_subset"), "flow traces");
      if (fixture.containsKey("expected_usage_subset")) assertSubset(fl.getUsage(), fixture.get("expected_usage_subset"), "flow usage");
      if (fixture.containsKey("expected_cache_store_subset")) assertSubset(Core.asMap(forwardOptions.getOrDefault("cache_store", forwardOptions.getOrDefault("cacheStore", Map.of()))), fixture.get("expected_cache_store_subset"), "flow cache store");
      if (fixture.containsKey("expected_cache_value_for_input")) assertEqual(Core.asMap(forwardOptions.getOrDefault("cache_store", forwardOptions.getOrDefault("cacheStore", Map.of()))).get(String.valueOf(Core._flow_cache_key(fixture.getOrDefault("input", Map.of())))), fixture.get("expected_cache_value_for_input"), "flow cache value");
      if (fixture.containsKey("expected_components_subset")) assertListSubset(fl.getOptimizableComponents(), fixture.get("expected_components_subset"), "flow components");
      if (fixture.containsKey("expected_error_contains")) throw new FixtureError("expected flow fixture to fail");
    } catch (RuntimeException e) {
      String expected = (String) fixture.get("expected_error_contains");
      if (expected != null && String.valueOf(e.getMessage()).contains(expected)) return;
      throw e;
    }
  }

  static void runOptimize(Map<String, Object> fixture) {
    String programKind = String.valueOf(fixture.getOrDefault("program", "agent"));
    String signature = String.valueOf(fixture.getOrDefault("signature", "question:string -> answer:string"));
    Map<String, Object> options = new LinkedHashMap<>(Core.asMap(fixture.getOrDefault("options", Map.of())));
    ToolBuild toolBuild = buildTools(Core.asList(fixture.getOrDefault("tools", List.of())));
    if (!toolBuild.tools.isEmpty()) options.put("functions", toolBuild.tools);
    Object program = "axgen".equals(programKind)
      ? new AxGen(AxSignature.create(signature), options)
      : "flow".equals(programKind)
        ? buildFlow(fixture)
        : Ax.agent(signature, options);
    String operation = String.valueOf(fixture.getOrDefault("operation", "components"));
    try {
      if ("components".equals(operation)) {
        Object components = ((AxProgram) program).getOptimizableComponents();
        if (fixture.containsKey("expected_components_subset")) assertListSubset(Core.asList(components), fixture.get("expected_components_subset"), "optimizable components");
        if (fixture.containsKey("expected_component_ids")) {
          List<Object> ids = new ArrayList<>();
          for (Object component : Core.asList(components)) ids.add(Core.asMap(component).get("id"));
          assertEqual(ids, fixture.get("expected_component_ids"), "component ids");
        }
        return;
      }
      if ("filter".equals(operation)) {
        Object components = ((AxProgram) program).getOptimizableComponents();
        Object filtered = Core._filter_optimization_components(components, fixture.getOrDefault("target", "all"));
        List<Object> ids = new ArrayList<>();
        for (Object component : Core.asList(filtered)) ids.add(Core.asMap(component).get("id"));
        assertEqual(ids, fixture.getOrDefault("expected_component_ids", List.of()), "filtered component ids");
        return;
      }
      if ("apply".equals(operation)) {
        Object components = ((AxProgram) program).getOptimizableComponents();
        Map<String, Object> artifact = Core.asMap(Core._optimized_artifact("fixture", "1", fixture.getOrDefault("component_map", Map.of()), fixture.getOrDefault("metadata", Map.of("source", "fixture"))));
        Object validated = Core._validate_optimized_artifact(artifact, components);
        Object payload = Boolean.TRUE.equals(fixture.get("serialized_artifact")) ? Core._serialize_optimized_artifact(validated) : validated;
        if ("axgen".equals(programKind)) ((AxGen) program).applyOptimization(payload);
        else if ("flow".equals(programKind)) ((AxFlow) program).applyOptimization(payload);
        else ((AxAgent) program).applyOptimization(payload);
        Object after = ((AxProgram) program).getOptimizableComponents();
        if (fixture.containsKey("expected_components_subset")) assertListSubset(Core.asList(after), fixture.get("expected_components_subset"), "optimized components");
        if (fixture.containsKey("expected_changed_components")) assertEqual(Core._optimization_changed_components(components, fixture.getOrDefault("component_map", Map.of())), fixture.get("expected_changed_components"), "changed components");
        return;
      }
      if ("artifact".equals(operation)) {
        Object components = ((AxProgram) program).getOptimizableComponents();
        Object artifact = Core._optimized_artifact("fixture", "1", fixture.getOrDefault("component_map", Map.of()), fixture.getOrDefault("metadata", Map.of()));
        Object validated = Core._validate_optimized_artifact(artifact, components);
        Object decoded = Core._deserialize_optimized_artifact(Core._serialize_optimized_artifact(validated), components);
        if (fixture.containsKey("expected_artifact_subset")) assertSubset(decoded, fixture.get("expected_artifact_subset"), "optimized artifact");
        return;
      }
      if ("dataset".equals(operation)) {
        Object normalized = Core._normalize_optimization_dataset(fixture.getOrDefault("dataset", List.of()));
        assertEqual(normalized, fixture.get("expected_dataset"), "normalized dataset");
        return;
      }
      if ("score".equals(operation)) {
        Object scores = Core._normalize_optimization_metric_scores(fixture.get("metric_score"));
        Object scalar = Core._scalarize_optimization_scores(scores, fixture.getOrDefault("score_options", Map.of()));
        Object adjusted = Core._adjust_optimization_score_for_actions(scalar, fixture.getOrDefault("task", Map.of()), fixture.getOrDefault("prediction", Map.of("functionCalls", List.of())));
        if (fixture.containsKey("expected_scores")) assertEqual(scores, fixture.get("expected_scores"), "metric scores");
        if (fixture.containsKey("expected_scalar")) assertEqual(adjusted, fixture.get("expected_scalar"), "metric scalar");
        if (fixture.containsKey("quality")) assertEqual(Core._map_optimization_judge_quality_to_score(fixture.get("quality")), fixture.get("expected_quality_score"), "judge quality score");
        return;
      }
      if ("judge_payload".equals(operation)) {
        Object payload = Core._build_optimization_judge_payload(fixture.getOrDefault("task", Map.of()), fixture.getOrDefault("prediction", Map.of()), fixture.getOrDefault("criteria", ""));
        if (fixture.containsKey("expected_judge_payload_subset")) assertSubset(payload, fixture.get("expected_judge_payload_subset"), "judge payload");
        return;
      }
      if ("evidence".equals(operation)) {
        Object components = fixture.getOrDefault("components", ((AxProgram) program).getOptimizableComponents());
        Object evidence = Core._build_optimizer_evidence_batch(fixture.getOrDefault("eval_result", Map.of()), Core.asList(components));
        if (fixture.containsKey("expected_evidence_subset")) assertSubset(evidence, fixture.get("expected_evidence_subset"), "optimizer evidence");
        return;
      }
      if ("evaluate".equals(operation)) {
        FakeAIService client = new FakeAIService(Core.asList(fixture.getOrDefault("responses", List.of())), Core.asList(fixture.getOrDefault("stream_events", List.of())));
        Map<String, Object> result = "axgen".equals(programKind)
          ? ((AxGen) program).evaluateOptimization(client, fixture.getOrDefault("dataset", List.of()), Core.asMap(fixture.getOrDefault("candidate_map", Map.of())), Core.asMap(fixture.getOrDefault("eval_options", Map.of())))
          : "flow".equals(programKind)
            ? ((AxFlow) program).evaluateOptimization(client, fixture.getOrDefault("dataset", List.of()), Core.asMap(fixture.getOrDefault("candidate_map", Map.of())), Core.asMap(fixture.getOrDefault("eval_options", Map.of())))
            : ((AxAgent) program).evaluateOptimization(client, fixture.getOrDefault("dataset", List.of()), Core.asMap(fixture.getOrDefault("candidate_map", Map.of())), Core.asMap(fixture.getOrDefault("eval_options", Map.of())));
        if (fixture.containsKey("expected_evaluation_subset")) assertSubset(result, fixture.get("expected_evaluation_subset"), "optimization evaluation");
        if (fixture.containsKey("expected_evaluation_rows_subset")) assertListSubset(Core.asList(result.getOrDefault("rows", List.of())), fixture.get("expected_evaluation_rows_subset"), "optimization evaluation rows");
        if (fixture.containsKey("expected_components_subset_after")) {
          Object after = ((AxProgram) program).getOptimizableComponents();
          assertListSubset(Core.asList(after), fixture.get("expected_components_subset_after"), "post-eval components");
        }
        return;
      }
      if ("engine".equals(operation)) {
        FakeOptimizerEngine engine = new FakeOptimizerEngine(fixture.getOrDefault("engine_response", Map.of()));
        Map<String, Object> opts = new LinkedHashMap<>(Core.asMap(fixture.getOrDefault("optimize_options", Map.of())));
        if (Boolean.TRUE.equals(fixture.get("engine_uses_evaluator"))) {
          opts.put("client", new FakeAIService(Core.asList(fixture.getOrDefault("responses", List.of())), Core.asList(fixture.getOrDefault("stream_events", List.of()))));
        }
        Map<String, Object> artifact = "axgen".equals(programKind)
          ? ((AxGen) program).optimizeWith(engine, Core.asMapList(fixture.getOrDefault("dataset", List.of())), opts)
          : "flow".equals(programKind)
            ? ((AxFlow) program).optimizeWith(engine, Core.asMapList(fixture.getOrDefault("dataset", List.of())), opts)
            : ((AxAgent) program).optimizeWith(engine, Core.asMapList(fixture.getOrDefault("dataset", List.of())), opts);
        if (fixture.containsKey("expected_engine_request_subset")) {
          if (engine.requests.isEmpty()) throw new FixtureError("optimizer engine was not called");
          assertSubset(engine.requests.get(0), fixture.get("expected_engine_request_subset"), "optimizer engine request");
        }
        if (fixture.containsKey("expected_engine_evaluations_subset")) assertListSubset(engine.evaluations, fixture.get("expected_engine_evaluations_subset"), "optimizer engine evaluations");
        if (fixture.containsKey("expected_engine_transcripts_subset")) assertListSubset(engine.transcripts, fixture.get("expected_engine_transcripts_subset"), "optimizer engine transcripts");
        if (fixture.containsKey("expected_artifact_subset")) assertSubset(artifact, fixture.get("expected_artifact_subset"), "optimizer artifact");
        if (fixture.containsKey("expected_components_subset")) {
          assertListSubset(((AxProgram) program).getOptimizableComponents(), fixture.get("expected_components_subset"), "optimized components");
        }
        return;
      }
      if ("eval".equals(operation)) {
        FakeAIService client = new FakeAIService(Core.asList(fixture.getOrDefault("responses", List.of())), Core.asList(fixture.getOrDefault("stream_events", List.of())));
        Map<String, Object> prediction = ((AxAgent) program).evaluateOptimizationTask(client, Core.asMap(fixture.getOrDefault("task", Map.of("input", fixture.getOrDefault("input", Map.of())))), Core.asMap(fixture.getOrDefault("eval_options", Map.of())));
        if (fixture.containsKey("expected_prediction_subset")) assertSubset(prediction, fixture.get("expected_prediction_subset"), "eval prediction");
        return;
      }
    } catch (RuntimeException e) {
      String expected = (String) fixture.get("expected_error_contains");
      if (expected != null && String.valueOf(e.getMessage()).contains(expected)) return;
      throw e;
    }
    throw new FixtureError("unknown optimize operation " + operation);
  }

  static void assertAgentTrace(AxAgent agent, Map<String, Object> fixture) {
    Map<String, Object> trace = agent.exportTrace();
    if (fixture.containsKey("expected_trace_subset")) assertSubset(trace, fixture.get("expected_trace_subset"), "agent trace");
    if (fixture.containsKey("expected_trace_event_kinds")) {
      List<Object> kinds = new ArrayList<>();
      for (Object rawEvent : Core.asList(trace.getOrDefault("events", List.of()))) {
        kinds.add(Core.asMap(rawEvent).get("kind"));
      }
      assertEqual(kinds, fixture.get("expected_trace_event_kinds"), "agent trace event kinds");
    }
    if (Boolean.TRUE.equals(fixture.get("replay_trace"))) {
      Map<String, Object> replayFixtures = new LinkedHashMap<>(Core.asMap(fixture.getOrDefault("replay_fixtures", Map.of())));
      if (fixture.containsKey("expected_trace_event_kinds") && !replayFixtures.containsKey("expected_event_kinds")) replayFixtures.put("expected_event_kinds", fixture.get("expected_trace_event_kinds"));
      if (fixture.containsKey("expected_output") && !replayFixtures.containsKey("expected_output")) replayFixtures.put("expected_output", fixture.get("expected_output"));
      Map<String, Object> replayed = agent.replayTrace(trace, replayFixtures);
      if (fixture.containsKey("expected_replay_result_subset")) assertSubset(replayed, fixture.get("expected_replay_result_subset"), "agent replay");
      else assertSubset(replayed, Map.of("ok", true, "status", "replayed"), "agent replay");
    }
  }

  static void runAgentForward(Map<String, Object> fixture) {
    FakeAIService client = new FakeAIService(Core.asList(fixture.getOrDefault("responses", List.of())), Core.asList(fixture.getOrDefault("stream_events", List.of())));
    Map<String, Object> agentOptions = new LinkedHashMap<>(Core.asMap(fixture.getOrDefault("options", Map.of())));
    FakeCodeRuntime runtime = null;
    if (fixture.containsKey("runtime_script")) {
      Map<String, Object> runtimeConfig = Core.asMap(agentOptions.getOrDefault("runtime", Map.of()));
      runtime = new FakeCodeRuntime(
        Core.asList(fixture.getOrDefault("runtime_script", List.of())),
        String.valueOf(runtimeConfig.getOrDefault("language", fixture.getOrDefault("runtime_language", "JavaScript"))),
        String.valueOf(runtimeConfig.getOrDefault("usageInstructions", runtimeConfig.getOrDefault("usage_instructions", "")))
      );
      agentOptions.put("runtime", runtime);
    }
    AxAgent agent = null;
    try {
      agent = Ax.agent(String.valueOf(fixture.get("signature")), agentOptions);
      if (fixture.containsKey("set_state")) agent.setState(Core.asMap(fixture.get("set_state")));
      Object output = agent.forward(client, Core.asMap(fixture.getOrDefault("input", Map.of())), Core.asMap(fixture.getOrDefault("forward_options", Map.of())));
      if (fixture.containsKey("expected_error_contains")) throw new FixtureError("expected agent forward to fail");
      if (fixture.containsKey("expected_output")) assertEqual(output, fixture.get("expected_output"), "agent output");
    } catch (AxAgentClarificationException e) {
      String expected = (String) fixture.get("expected_error_contains");
      if (expected == null || !String.valueOf(e.getMessage()).contains(expected)) throw e;
      if (fixture.containsKey("expected_clarification")) assertSubset(e.clarification(), fixture.get("expected_clarification"), "clarification");
      if (agent != null) assertAgentTrace(agent, fixture);
      return;
    } catch (RuntimeException e) {
      String expected = (String) fixture.get("expected_error_contains");
      if (expected != null && String.valueOf(e.getMessage()).contains(expected)) {
        if (agent != null) assertAgentTrace(agent, fixture);
        return;
      }
      throw e;
    }
    if (fixture.containsKey("expected_request_count") && client.requests.size() != Core.asInt(fixture.get("expected_request_count"))) throw new FixtureError("expected agent request count mismatch");
    if (fixture.containsKey("expected_request_contains")) {
      String text = Json.stringify(client.requests);
      for (Object item : Core.asList(fixture.get("expected_request_contains"))) if (!text.contains(String.valueOf(item))) throw new FixtureError("agent request missing " + item + ": " + text);
    }
    if (fixture.containsKey("expected_stage_request_not_contains")) {
      for (Object raw : Core.asList(fixture.get("expected_stage_request_not_contains"))) {
        Map<String, Object> spec = Core.asMap(raw);
        int index = Core.asInt(spec.getOrDefault("index", 0));
        String text = index < client.requests.size() ? Json.stringify(client.requests.get(index)) : "";
        for (Object item : Core.asList(spec.getOrDefault("absent", List.of()))) if (text.contains(String.valueOf(item))) throw new FixtureError("agent request " + index + " unexpectedly contained " + item + ": " + text);
      }
    }
    if (fixture.containsKey("expected_cached_request_indices")) {
      for (Object rawIndex : Core.asList(fixture.get("expected_cached_request_indices"))) {
        int index = Core.asInt(rawIndex);
        if (index >= client.requests.size()) throw new FixtureError("missing cached request index " + index);
        boolean hasCache = false;
        for (Object rawMessage : Core.asList(client.requests.get(index).get("chat_prompt"))) {
          if (Boolean.TRUE.equals(Core.asMap(rawMessage).get("cache"))) {
            hasCache = true;
            break;
          }
        }
        if (!hasCache) throw new FixtureError("agent request " + index + " did not contain a cached prompt message");
      }
    }
    if (fixture.containsKey("expected_chat_log_subset")) assertListSubset(agent.getChatLog(), fixture.get("expected_chat_log_subset"), "agent chat log");
    if (fixture.containsKey("expected_state")) assertSubset(agent.getState(), fixture.get("expected_state"), "agent state");
    Map<String, Object> exported = agent.exportRuntimeState();
    if (fixture.containsKey("expected_runtime_contract_subset")) assertSubset(agent.getRuntimeContract(), fixture.get("expected_runtime_contract_subset"), "runtime contract");
    if (fixture.containsKey("expected_exported_state_subset")) assertSubset(exported, fixture.get("expected_exported_state_subset"), "runtime state");
    if (fixture.containsKey("expected_action_log_subset")) assertListSubset(Core.asList(exported.get("action_log")), fixture.get("expected_action_log_subset"), "action log");
    if (runtime != null && fixture.containsKey("expected_executed")) assertEqual(runtime.executed, fixture.get("expected_executed"), "executed code");
    assertAgentTrace(agent, fixture);
  }

  static void runAgentRuntimePolicy(Map<String, Object> fixture) {
    AxAgent agent = null;
    try {
      agent = Ax.agent(String.valueOf(fixture.getOrDefault("signature", "question:string -> answer:string")), Core.asMap(fixture.getOrDefault("options", Map.of())));
      if (fixture.containsKey("discover")) {
        Object discoverValue = fixture.getOrDefault("discover", Map.of());
        Object result = agent.discover(discoverValue instanceof Map<?, ?> ? Core.asMap(discoverValue) : new LinkedHashMap<>(Map.of("tools", discoverValue)));
        if (fixture.containsKey("expected_discover_result")) assertEqual(result, fixture.get("expected_discover_result"), "discover result");
      }
      if (fixture.containsKey("recall")) {
        Object result = agent.recall(fixture.getOrDefault("recall", List.of()));
        if (fixture.containsKey("expected_recall_result")) assertEqual(result, fixture.get("expected_recall_result"), "recall result");
      }
      if (fixture.containsKey("used")) {
        Map<String, Object> used = Core.asMap(fixture.get("used"));
        Object result = agent.used(String.valueOf(used.get("id")), String.valueOf(used.getOrDefault("reason", "")), String.valueOf(used.getOrDefault("stage", "executor")));
        if (fixture.containsKey("expected_used_result")) assertEqual(result, fixture.get("expected_used_result"), "used result");
      }
      if (fixture.containsKey("invoke_callable")) {
        Map<String, Object> call = Core.asMap(fixture.get("invoke_callable"));
        Object result = agent.invokeCallable(String.valueOf(call.getOrDefault("qualified_name", call.get("name"))), Core.asMap(call.getOrDefault("args", Map.of())));
        if (fixture.containsKey("expected_callable_result_subset")) assertSubset(result, fixture.get("expected_callable_result_subset"), "callable result");
      }
      if (fixture.containsKey("replay_trace_input")) {
        Object result = agent.replayTrace(fixture.getOrDefault("replay_trace_input", Map.of()), Core.asMap(fixture.getOrDefault("replay_fixtures", Map.of())));
        if (fixture.containsKey("expected_replay_result_subset")) assertSubset(result, fixture.get("expected_replay_result_subset"), "agent replay");
      }
      if (fixture.containsKey("restore_runtime_state")) agent.restoreRuntimeState(Core.asMap(fixture.get("restore_runtime_state")));
      if (fixture.containsKey("final_payload")) assertEqual(Core._normalize_agent_final_payload(fixture.get("final_payload")), fixture.get("expected_final_payload"), "final payload");
      if (fixture.containsKey("clarification_payload")) assertEqual(Core._normalize_agent_clarification_payload(fixture.get("clarification_payload")), fixture.get("expected_clarification_payload"), "clarification payload");
    } catch (RuntimeException e) {
      String expected = (String) fixture.get("expected_error_contains");
      if (expected != null && String.valueOf(e.getMessage()).contains(expected)) return;
      throw e;
    }
    if (fixture.containsKey("expected_error_contains")) throw new FixtureError("expected agent runtime policy fixture to fail");
    if (fixture.containsKey("expected_runtime_contract_subset")) assertSubset(agent.getRuntimeContract(), fixture.get("expected_runtime_contract_subset"), "runtime contract");
    if (fixture.containsKey("expected_policy_subset")) assertSubset(agent.getPolicy(), fixture.get("expected_policy_subset"), "agent policy");
    if (fixture.containsKey("expected_policy_registry_subset")) assertSubset(agent.getPolicyRegistry(), fixture.get("expected_policy_registry_subset"), "policy registry");
    Map<String, Object> registry = agent.getPolicyRegistry();
    if (fixture.containsKey("expected_actor_primitives_subset")) assertListSubset(Core.asList(registry.get("actor_primitives")), fixture.get("expected_actor_primitives_subset"), "actor primitives");
    if (fixture.containsKey("expected_protocol_actions_subset")) assertListSubset(Core.asList(registry.get("protocol_actions")), fixture.get("expected_protocol_actions_subset"), "protocol actions");
    if (fixture.containsKey("expected_runtime_globals_subset")) assertListSubset(Core.asList(registry.get("runtime_globals")), fixture.get("expected_runtime_globals_subset"), "runtime globals");
    if (fixture.containsKey("expected_host_boundaries_subset")) assertListSubset(Core.asList(registry.get("host_boundaries")), fixture.get("expected_host_boundaries_subset"), "host boundaries");
    if (fixture.containsKey("expected_callable_inventory_subset")) assertListSubset(agent.getCallableInventory(), fixture.get("expected_callable_inventory_subset"), "callable inventory");
    if (fixture.containsKey("expected_discovery_catalog_subset")) assertListSubset(agent.getDiscoveryCatalog(), fixture.get("expected_discovery_catalog_subset"), "discovery catalog");
    Map<String, Object> exported = agent.exportRuntimeState();
    if (fixture.containsKey("expected_discovered_tool_docs_subset")) assertListSubset(Core.asList(exported.get("discovered_tool_docs")), fixture.get("expected_discovered_tool_docs_subset"), "discovered tools");
    if (fixture.containsKey("expected_loaded_skill_docs_subset")) assertListSubset(Core.asList(exported.get("loaded_skill_docs")), fixture.get("expected_loaded_skill_docs_subset"), "loaded skills");
    if (fixture.containsKey("expected_loaded_memories_subset")) assertListSubset(Core.asList(exported.get("loaded_memories")), fixture.get("expected_loaded_memories_subset"), "loaded memories");
    if (fixture.containsKey("expected_used_memories_subset")) assertListSubset(Core.asList(exported.get("used_memories")), fixture.get("expected_used_memories_subset"), "used memories");
    if (fixture.containsKey("expected_used_skills_subset")) assertListSubset(Core.asList(exported.get("used_skills")), fixture.get("expected_used_skills_subset"), "used skills");
    if (fixture.containsKey("expected_guidance_log_subset")) assertListSubset(Core.asList(exported.get("guidance_log")), fixture.get("expected_guidance_log_subset"), "guidance log");
    if (fixture.containsKey("expected_function_call_traces_subset")) assertListSubset(Core.asList(exported.get("function_call_traces")), fixture.get("expected_function_call_traces_subset"), "function call traces");
    if (fixture.containsKey("expected_policy_trace_subset")) assertListSubset(Core.asList(exported.get("policy_trace")), fixture.get("expected_policy_trace_subset"), "policy trace");
    if (fixture.containsKey("expected_exported_state_subset")) assertSubset(exported, fixture.get("expected_exported_state_subset"), "exported runtime state");
    if (fixture.containsKey("expected_optimizer_metadata_subset")) assertSubset(agent.getOptimizerMetadata(), fixture.get("expected_optimizer_metadata_subset"), "optimizer metadata");
    assertAgentTrace(agent, fixture);
  }

  static void runAgentRuntimeSession(Map<String, Object> fixture) {
    AxAgent agent = Ax.agent(String.valueOf(fixture.getOrDefault("signature", "question:string -> answer:string")), Core.asMap(fixture.getOrDefault("options", Map.of())));
    FakeCodeRuntime runtime = new FakeCodeRuntime(Core.asList(fixture.getOrDefault("runtime_script", List.of())));
    Object result = null;
    try {
      String operation = String.valueOf(fixture.getOrDefault("operation", "test"));
      if ("test".equals(operation)) {
        result = agent.test(runtime, String.valueOf(fixture.getOrDefault("code", "")), Core.asMap(fixture.getOrDefault("context_values", fixture.getOrDefault("input", Map.of()))), Core.asMap(fixture.getOrDefault("runtime_options", Map.of())));
      } else if ("steps".equals(operation)) {
        for (Object rawStep : Core.asList(fixture.getOrDefault("steps", List.of()))) {
          Map<String, Object> step = Core.asMap(rawStep);
          if (step.containsKey("restore_session_state")) agent.restoreSessionState(step.get("restore_session_state"));
          result = agent.executeActorStep(runtime, String.valueOf(step.getOrDefault("code", "")), Core.asMap(step.getOrDefault("values", fixture.getOrDefault("context_values", fixture.getOrDefault("input", Map.of())))), Core.asMap(step.getOrDefault("options", Map.of())));
          if (Boolean.TRUE.equals(step.get("inspect"))) agent.inspectRuntime();
          if (Boolean.TRUE.equals(step.get("export_session_state"))) agent.exportSessionState();
        }
        if (Boolean.TRUE.equals(fixture.get("close_runtime_session"))) agent.closeRuntimeSession();
      } else if ("reserved".equals(operation)) {
        result = agent.test(runtime, String.valueOf(fixture.getOrDefault("code", "")), Core.asMap(fixture.getOrDefault("context_values", Map.of())), Map.of());
      } else {
        throw new FixtureError("unknown agent runtime session operation " + operation);
      }
    } catch (RuntimeException e) {
      String expected = (String) fixture.get("expected_error_contains");
      if (expected != null && String.valueOf(e.getMessage()).contains(expected)) return;
      throw e;
    }
    if (fixture.containsKey("expected_error_contains")) throw new FixtureError("expected agent runtime session fixture to fail");
    if (fixture.containsKey("expected_result_subset")) assertSubset(result, fixture.get("expected_result_subset"), "runtime result");
    if (fixture.containsKey("expected_result")) assertEqual(result, fixture.get("expected_result"), "runtime result");
    Map<String, Object> exported = agent.exportRuntimeState();
    if (fixture.containsKey("expected_exported_state_subset")) assertSubset(exported, fixture.get("expected_exported_state_subset"), "runtime state");
    if (fixture.containsKey("expected_action_log_subset")) assertListSubset(Core.asList(exported.get("action_log")), fixture.get("expected_action_log_subset"), "action log");
    if (fixture.containsKey("expected_status_log_subset")) assertListSubset(Core.asList(exported.get("status_log")), fixture.get("expected_status_log_subset"), "status log");
    if (fixture.containsKey("expected_session_count") && runtime.sessions.size() != Core.asInt(fixture.get("expected_session_count"))) throw new FixtureError("expected session count mismatch");
    if (fixture.containsKey("expected_executed")) assertEqual(runtime.executed, fixture.get("expected_executed"), "executed code");
    assertAgentTrace(agent, fixture);
  }

  static void runAIChat(Map<String, Object> fixture) {
    ClientFixture cf = openaiClient(fixture);
    Object result;
    try { result = cf.client.chat(Core.asMap(fixture.get("request"))); } catch (Exception e) { throw Core.asRuntime(e); }
    if (fixture.containsKey("expected_output")) assertEqual(result, fixture.get("expected_output"), "ai chat output");
    assertTransport(fixture, cf.transport);
  }

  static void runAIEmbed(Map<String, Object> fixture) {
    ClientFixture cf = openaiClient(fixture);
    Object result;
    try { result = cf.client.embed(Core.asMap(fixture.get("request"))); } catch (Exception e) { throw Core.asRuntime(e); }
    if (fixture.containsKey("expected_output")) assertEqual(result, fixture.get("expected_output"), "ai embed output");
    assertTransport(fixture, cf.transport);
  }

  static void runAIStream(Map<String, Object> fixture) {
    ClientFixture cf = openaiClient(fixture);
    List<Object> result = new ArrayList<>();
    try { for (Object item : cf.client.stream(Core.asMap(fixture.get("request")))) result.add(item); } catch (Exception e) { throw Core.asRuntime(e); }
    if (fixture.containsKey("expected_output")) assertEqual(result, fixture.get("expected_output"), "ai stream output");
    assertTransport(fixture, cf.transport);
  }

  static void runAIError(Map<String, Object> fixture) {
    ClientFixture cf = openaiClient(fixture);
    try {
      String method = String.valueOf(fixture.getOrDefault("method", "chat"));
      if ("stream".equals(method)) for (Object ignored : cf.client.stream(Core.asMap(fixture.get("request")))) {}
      else if ("embed".equals(method)) cf.client.embed(Core.asMap(fixture.get("request")));
      else cf.client.chat(Core.asMap(fixture.get("request")));
    } catch (Exception e) {
      String expected = (String) fixture.get("expected_error_contains");
      if (expected != null && !String.valueOf(e.getMessage()).contains(expected)) throw new FixtureError("expected error containing " + expected + ", got " + e);
      if (fixture.get("expected_error_type") != null && !e.getClass().getSimpleName().equals(fixture.get("expected_error_type"))) throw new FixtureError("expected error type " + fixture.get("expected_error_type") + ", got " + e.getClass().getSimpleName());
      if (fixture.get("expected_status") != null && e instanceof AxAIServiceError ai && !java.util.Objects.equals(ai.status, Core.asInt(fixture.get("expected_status")))) throw new FixtureError("status mismatch");
      assertTransport(fixture, cf.transport);
      return;
    }
    throw new FixtureError("expected AxAI call to fail");
  }

  static void runAIUnsupported(Map<String, Object> fixture) {
    ClientFixture cf = openaiClient(fixture);
    try {
      if ("speak".equals(fixture.get("method"))) cf.client.speak(Core.asMap(fixture.getOrDefault("request", Map.of())));
      else cf.client.transcribe(Core.asMap(fixture.getOrDefault("request", Map.of())));
    } catch (RuntimeException e) {
      String expected = (String) fixture.get("expected_error_contains");
      if (expected != null && !String.valueOf(e.getMessage()).contains(expected)) throw new FixtureError("expected error containing " + expected + ", got " + e);
      return;
    }
    throw new FixtureError("expected unsupported capability error");
  }

  interface ThrowingSupplier { Object get(); }
  static Object expectMaybeError(ThrowingSupplier supplier, Map<String, Object> fixture) {
    try {
      Object value = supplier.get();
      if (fixture.containsKey("expected_error_contains")) throw new FixtureError("expected operation to fail");
      return value;
    } catch (RuntimeException e) {
      if (!fixture.containsKey("expected_error_contains")) throw e;
      String expected = (String) fixture.get("expected_error_contains");
      if (expected != null && !String.valueOf(e.getMessage()).contains(expected)) throw new FixtureError("expected error containing " + expected + ", got " + e);
      return null;
    }
  }

  static AxSignature buildSignature(Map<String, Object> fixture) {
    if (fixture.containsKey("signature_spec")) return signatureFromSpec(Core.asMap(fixture.get("signature_spec")));
    return Ax.s(String.valueOf(fixture.get("signature")));
  }

  static AxSignature signatureFromSpec(Map<String, Object> spec) {
    AxSignature.Builder builder = Ax.f().call();
    if (spec.get("description") != null) builder.description(String.valueOf(spec.get("description")));
    for (Map.Entry<String, Object> e : Core.asMap(spec.get("inputs")).entrySet()) builder.input(e.getKey(), fieldFromSpec(Core.asMap(e.getValue())));
    for (Map.Entry<String, Object> e : Core.asMap(spec.get("outputs")).entrySet()) builder.output(e.getKey(), fieldFromSpec(Core.asMap(e.getValue())));
    return builder.build();
  }

  static Field.Fluent fieldFromSpec(Map<String, Object> spec) {
    String typ = String.valueOf(spec.getOrDefault("type", "string"));
    Field.Factory f = Ax.f();
    Field.Fluent field;
    switch (typ) {
      case "class" -> field = f.classification(stringList(spec.get("options")), (String) spec.get("description"));
      case "object" -> {
        Map<String, Field.Fluent> nested = new LinkedHashMap<>();
        for (Map.Entry<String, Object> e : Core.asMap(spec.get("fields")).entrySet()) nested.put(e.getKey(), fieldFromSpec(Core.asMap(e.getValue())));
        field = f.object(nested, (String) spec.get("description"));
      }
      case "number" -> field = f.number((String) spec.get("description"));
      case "boolean" -> field = f.boolean_((String) spec.get("description"));
      case "json" -> field = f.json((String) spec.get("description"));
      case "date" -> field = f.date((String) spec.get("description"));
      case "datetime" -> field = f.datetime((String) spec.get("description"));
      case "dateRange" -> field = f.dateRange((String) spec.get("description"));
      case "datetimeRange" -> field = f.datetimeRange((String) spec.get("description"));
      case "image" -> field = f.image((String) spec.get("description"));
      case "audio" -> field = f.audio((String) spec.get("description"));
      case "file" -> field = f.file((String) spec.get("description"));
      case "url" -> field = f.url((String) spec.get("description"));
      case "code" -> field = f.code((String) spec.get("description"));
      default -> field = f.string((String) spec.get("description"));
    }
    if (Core.truthy(spec.get("array"))) field = field.array((String) spec.get("arrayDescription"));
    if (Core.truthy(spec.get("optional"))) field = field.optional();
    if (Core.truthy(spec.get("internal"))) field = field.internal();
    if (Core.truthy(spec.get("cache"))) field = field.cache();
    if (spec.get("min") != null) field = field.min(Core.asInt(spec.get("min")));
    if (spec.get("max") != null) field = field.max(Core.asInt(spec.get("max")));
    if (Core.truthy(spec.get("email"))) field = field.email();
    if (Core.truthy(spec.get("url"))) field = field.url();
    if (spec.get("pattern") != null) field = field.regex(String.valueOf(spec.get("pattern")), String.valueOf(spec.getOrDefault("patternDescription", spec.get("pattern"))));
    return field;
  }

  static Map<String, Object> signaturePayload(AxSignature sig) {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("description", sig.description);
    out.put("inputs", fieldPayloads(sig.inputs));
    out.put("outputs", fieldPayloads(sig.outputs));
    return out;
  }
  static List<Object> fieldPayloads(List<Field> fields) { List<Object> out = new ArrayList<>(); for (Field f : fields) out.add(fieldPayload(f)); return out; }
  static Map<String, Object> fieldPayload(Field field) {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("name", field.name); out.put("title", field.title); out.put("type", typePayload(field.type));
    out.put("isOptional", field.optional); out.put("isInternal", field.internal); out.put("isCached", field.cached);
    if (field.description != null) out.put("description", field.description);
    return out;
  }
  static Map<String, Object> typePayload(FieldType t) {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("name", t.name); out.put("isArray", t.array);
    if (t.options != null) out.put("options", t.options);
    if (t.description != null) out.put("description", t.description);
    if (t.fields != null && !t.fields.isEmpty()) { Map<String, Object> fields = new LinkedHashMap<>(); for (Map.Entry<String, Object> e : t.fields.entrySet()) fields.put(e.getKey(), fieldPayload(e.getValue() instanceof Field f ? f : new Field(e.getKey(), (FieldType) e.getValue(), null, false, false, false))); out.put("fields", fields); }
    if (t.minLength != null) out.put("minLength", t.minLength);
    if (t.maxLength != null) out.put("maxLength", t.maxLength);
    if (t.minimum != null) out.put("minimum", t.minimum);
    if (t.maximum != null) out.put("maximum", t.maximum);
    if (t.pattern != null) out.put("pattern", t.pattern);
    if (t.patternDescription != null) out.put("patternDescription", t.patternDescription);
    if (t.format != null) out.put("format", t.format);
    return out;
  }

  static final class ToolBuild {
    final List<Tool> tools = new ArrayList<>();
    final List<Object> calls = new ArrayList<>();
  }
  static ToolBuild buildTools(List<Object> specs) {
    ToolBuild out = new ToolBuild();
    for (Object item : specs) {
      Map<String, Object> spec = Core.asMap(item);
      Tool.Builder builder = Ax.fn(String.valueOf(spec.get("name"))).description(String.valueOf(spec.getOrDefault("description", spec.get("name"))));
      for (Map.Entry<String, Object> e : Core.asMap(spec.get("args")).entrySet()) builder.arg(e.getKey(), fieldFromSpec(Core.asMap(e.getValue())));
      for (Map.Entry<String, Object> e : Core.asMap(spec.get("returns")).entrySet()) builder.returnsField(e.getKey(), fieldFromSpec(Core.asMap(e.getValue())));
      Object result = spec.get("result");
      Object error = spec.get("error");
      builder.handler(args -> {
        out.calls.add(new LinkedHashMap<>(Map.of("name", spec.get("name"), "args", new LinkedHashMap<>(args))));
        if (error != null) throw new RuntimeException(String.valueOf(error));
        return result;
      });
      out.tools.add(builder.build());
    }
    return out;
  }

  static final class ClientFixture {
    final OpenAICompatibleClient client;
    final FakeTransport transport;
    ClientFixture(OpenAICompatibleClient client, FakeTransport transport) { this.client = client; this.transport = transport; }
  }
  static ClientFixture openaiClient(Map<String, Object> fixture) {
    FakeTransport transport = new FakeTransport(Core.asList(fixture.getOrDefault("transport_responses", fixture.getOrDefault("responses", List.of()))));
    Map<String, Object> options = new LinkedHashMap<>();
    options.put("model", fixture.getOrDefault("model", "gpt-4.1-mini"));
    options.put("embed_model", fixture.getOrDefault("embed_model", "text-embedding-3-small"));
    options.put("api_key", "test-key");
    options.put("transport", transport);
    options.put("model_config", fixture.get("model_config"));
    return new ClientFixture(new OpenAICompatibleClient(options), transport);
  }

  static void assertTransport(Map<String, Object> fixture, FakeTransport transport) {
    if (!fixture.containsKey("expected_transport_request")) return;
    if (transport.requests.isEmpty()) throw new FixtureError("expected provider transport request but none were sent");
    assertSubset(transport.requests.get(0), fixture.get("expected_transport_request"), "provider request");
  }
  static List<String> stringList(Object value) { List<String> out = new ArrayList<>(); for (Object item : Core.asList(value)) out.add(String.valueOf(item)); return out; }
  static void assertEqual(Object actual, Object expected, String label) {
    if (actual == null || expected == null) {
      if (actual != expected) throw new FixtureError(label + " mismatch\nactual: " + Json.stringify(actual) + "\nexpected: " + Json.stringify(expected));
      return;
    }
    if (!canonical(actual).equals(canonical(expected))) throw new FixtureError(label + " mismatch\nactual: " + Json.stringify(actual) + "\nexpected: " + Json.stringify(expected));
  }
	  static void assertSubset(Object actual, Object expected, String label) {
	    if (expected instanceof Map<?, ?> exp) {
	      Map<String, Object> act = Core.asMap(actual);
	      for (Map.Entry<?, ?> e : exp.entrySet()) {
	        if (!act.containsKey(e.getKey())) throw new FixtureError(label + " missing key " + e.getKey());
	        assertSubset(act.get(e.getKey()), e.getValue(), label + "." + e.getKey());
	      }
	    } else if (expected instanceof List<?>) assertEqual(actual, expected, label);
	    else {
	      if (actual == null || expected == null) {
	        if (actual != expected) throw new FixtureError(label + " expected " + expected + ", got " + actual);
	      } else if (!canonical(actual).equals(canonical(expected))) throw new FixtureError(label + " expected " + expected + ", got " + actual);
	    }
	  }
	  static void assertListSubset(Object actual, Object expected, String label) {
	    List<Object> act = Core.asList(actual);
	    int start = 0;
	    for (Object expectedItem : Core.asList(expected)) {
	      boolean matched = false;
	      for (int i = start; i < act.size(); i++) {
	        try {
	          assertSubset(act.get(i), expectedItem, label + "[" + i + "]");
	          start = i + 1;
	          matched = true;
	          break;
	        } catch (FixtureError ignored) {}
	      }
	      if (!matched) throw new FixtureError(label + " missing expected item " + Json.stringify(expectedItem));
	    }
	  }
  static Object canonical(Object value) {
    if (value instanceof Number n) {
      double d = n.doubleValue();
      if (Math.rint(d) == d) return (long) d;
      return d;
    }
    if (value instanceof Map<?, ?> map) { Map<String, Object> out = new LinkedHashMap<>(); for (Map.Entry<?, ?> e : map.entrySet()) out.put(String.valueOf(e.getKey()), canonical(e.getValue())); return out; }
    if (value instanceof Iterable<?> list) { List<Object> out = new ArrayList<>(); for (Object item : list) out.add(canonical(item)); return out; }
    return value;
  }
}
`
