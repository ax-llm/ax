package dev.axllm.ax;

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

  private static final String AXIR_COVERAGE_PATH = System.getenv("AXIR_COVERAGE_FILE");
  private static final java.util.Set<String> AXIR_COVERAGE_SEEN =
      java.util.concurrent.ConcurrentHashMap.newKeySet();

  static void axirCoverageMark(String name) {
    if (AXIR_COVERAGE_PATH == null || !AXIR_COVERAGE_SEEN.add(name)) {
      return;
    }
    try {
      java.nio.file.Files.writeString(
          java.nio.file.Path.of(AXIR_COVERAGE_PATH),
          name + "\n",
          java.nio.file.StandardOpenOption.CREATE,
          java.nio.file.StandardOpenOption.APPEND);
    } catch (java.io.IOException ignored) {
      // coverage tracing must never affect behavior
    }
  }

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
        case "streaming_assertions", "streamingAssertions" -> g.streamingAssertions;
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
    int s = Math.max(0, Math.min(text.length(), asInt(start)));
    if (end == null) return text.substring(s);
    int e = Math.max(s, Math.min(text.length(), asInt(end)));
    return text.substring(s, e);
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

  static Map<String, Object> defaultRouterFeatures() {
    return Map.of(
      "functions", false,
      "streaming", false,
      "media", Map.of(
        "images", Map.of("supported", false, "formats", List.of()),
        "audio", Map.of("supported", false, "formats", List.of(), "output", Map.of("supported", false, "formats", List.of())),
        "files", Map.of("supported", false, "formats", List.of(), "uploadMethod", "none"),
        "urls", Map.of("supported", false, "webSearch", false, "contextFetching", false)
      ),
      "caching", Map.of("supported", false, "types", List.of()),
      "thinking", false,
      "multiTurn", true
    );
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
  static Object agentTranscribe(Object client, Object request, Object options) {
    // Backs intrinsic.agent.transcribe: call the AI client's transcribe so audio inputs become
    // text before the agent loop (the client passes through _agent_forward as a real client).
    if (!(client instanceof AiClient ai)) return Map.of("text", "");
    try {
      return ai.transcribe(asMap(request), asMap(options));
    } catch (Exception e) {
      throw new RuntimeException(e);
    }
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
