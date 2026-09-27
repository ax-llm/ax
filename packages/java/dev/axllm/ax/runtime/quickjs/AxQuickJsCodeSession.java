package dev.axllm.ax.runtime.quickjs;

import dev.axllm.ax.AxCodeSession;
import dev.axllm.ax.Json;
import io.roastedroot.quickjs4j.core.Builtins;
import io.roastedroot.quickjs4j.core.Engine;
import io.roastedroot.quickjs4j.core.GuestFunction;
import io.roastedroot.quickjs4j.core.HostFunction;
import io.roastedroot.quickjs4j.core.Invokables;
import io.roastedroot.quickjs4j.core.Runner;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;

public final class AxQuickJsCodeSession implements AxCodeSession {
  private static final Invokables INVOKABLES = Invokables.builder("axir")
    .add(new GuestFunction("__ax_run", List.of(String.class), String.class))
    .build();
  private final Map<String, Object> bindings = new LinkedHashMap<>();
  private final Map<String, Object> reserved = new LinkedHashMap<>();
  private final Map<String, AxQuickJsHostCallable> hostCallables = new LinkedHashMap<>();
  // TS's AxJSRuntime snapshot entries of the user globals, from the engine's
  // last run over the current bindings.
  private Object entries = List.of();
  // The agent phase: a merge patch starts the executor's, after which the
  // distiller's final no longer keeps evidence.
  private String phase = "distiller";
  private final Map<String, Object> runtimePolicy;
  private final int timeoutMs;
  private boolean closed = false;

  AxQuickJsCodeSession(Map<String, Object> globals, Map<String, Object> options, Map<String, AxQuickJsHostCallable> hostCallables) {
    if (hostCallables != null) this.hostCallables.putAll(hostCallables);
    this.runtimePolicy = AxQuickJsCodeRuntime.mergePolicy(Map.of(), options.get("runtimePolicy"));
    Object reservedNames = options.get("reservedNames");
    if (reservedNames instanceof Iterable<?> items) {
      for (Object item : items) reserved.put(String.valueOf(item), true);
    }
    for (Map.Entry<String, Object> entry : globals.entrySet()) {
      bindings.put(entry.getKey(), entry.getValue());
      if (isHostCallable(entry.getValue())) reserved.put(entry.getKey(), true);
    }
    for (String name : this.hostCallables.keySet()) {
      reserved.put(name, true);
      bindings.putIfAbsent(name, Map.of("__ax_host_callable", true, "native", true));
    }
    this.timeoutMs = intOption(options.get("timeoutMs"), intOption(runtimePolicy.get("timeoutMs"), 5000));
  }

  public Object execute(String code, Map<String, Object> options) {
    if (closed) return Map.of("kind", "error", "is_error", true, "error_category", "session_closed", "error", "session closed");
    try {
      Map<String, Object> payload = new LinkedHashMap<>();
      payload.put("code", code == null ? "" : code);
      payload.put("phase", phase);
      payload.put("bindings", new LinkedHashMap<>(bindings));
      payload.put("reserved", reserved.keySet().stream().toList());
      String raw = runQuickJs(Json.stringify(payload), intOption(options == null ? null : options.get("timeoutMs"), timeoutMs));
      Map<String, Object> response = Json.asObject(Json.parse(raw));
      Object analysis = response.get("analysis");
      if (Boolean.FALSE.equals(response.get("ok"))) {
        Map<String, Object> failure = new LinkedHashMap<>();
        failure.put("kind", "error");
        failure.put("is_error", true);
        failure.put("error_category", String.valueOf(response.getOrDefault("category", "runtime")));
        failure.put("error", String.valueOf(response.getOrDefault("error", "QuickJS runtime error")));
        if (analysis != null) failure.put("analysis", analysis);
        return failure;
      }
      if (response.get("entries") != null) entries = response.get("entries");
      Map<String, Object> preservedReserved = new LinkedHashMap<>();
      for (String name : reserved.keySet()) {
        if (bindings.containsKey(name)) preservedReserved.put(name, bindings.get(name));
      }
      bindings.clear();
      bindings.putAll(Json.asObject(response.get("bindings")));
      for (String name : reserved.keySet()) {
        if (preservedReserved.containsKey(name)) bindings.put(name, preservedReserved.get(name));
        else bindings.remove(name);
      }
      Object result = response.get("result");
      if (analysis != null) {
        // The turn's code analysis rides on its payload (a plain turn's too).
        Map<String, Object> withAnalysis = new LinkedHashMap<>();
        if (result instanceof Map<?, ?> resultMap) {
          for (Map.Entry<?, ?> entry : resultMap.entrySet()) withAnalysis.put(String.valueOf(entry.getKey()), entry.getValue());
        } else {
          withAnalysis.put("kind", "result");
          withAnalysis.put("result", result);
        }
        withAnalysis.put("analysis", analysis);
        return withAnalysis;
      }
      return result;
    } catch (Exception ex) {
      return Map.of("kind", "error", "is_error", true, "error_category", errorCategory(ex), "error", ex.getMessage());
    }
  }

  public Object inspectGlobals(Map<String, Object> options) {
    return snapshotBindings();
  }

  public Object snapshotGlobals(Map<String, Object> options) {
    return Map.of("version", 1, "entries", entries, "bindings", snapshotBindings(), "globals", snapshotBindings());
  }

  public Object patchGlobals(Object snapshot, Map<String, Object> options) {
    // A merge patch (the agent's own globals for the executor, as TS's
    // patchGlobals) keeps the session's variables and updates its reserved
    // values; any other patch replaces the user globals.
    boolean merge = Boolean.TRUE.equals(Json.asObject(snapshot).get("merge"));
    if (merge) phase = "executor";
    Map<String, Object> next = Json.asObject(snapshot);
    if (next.containsKey("bindings")) next = Json.asObject(next.get("bindings"));
    if (!merge) {
      Map<String, Object> preserved = new LinkedHashMap<>();
      for (String name : reserved.keySet()) {
        if (this.bindings.containsKey(name)) preserved.put(name, this.bindings.get(name));
      }
      this.bindings.clear();
      this.bindings.putAll(preserved);
    }
    for (Map.Entry<String, Object> entry : next.entrySet()) {
      if (entry.getKey().startsWith("__ax_") || isHostCallable(entry.getValue())) continue;
      if (reserved.containsKey(entry.getKey()) && !merge) continue;
      this.bindings.put(entry.getKey(), entry.getValue());
    }
    refreshEntries();
    return snapshotGlobals(options);
  }

  // Re-reads the snapshot entries from the engine over the current bindings.
  private void refreshEntries() {
    try {
      Map<String, Object> payload = new LinkedHashMap<>();
      payload.put("code", "");
      payload.put("inspect", true);
      payload.put("bindings", new LinkedHashMap<>(bindings));
      payload.put("reserved", reserved.keySet().stream().toList());
      Map<String, Object> response = Json.asObject(Json.parse(runQuickJs(Json.stringify(payload), timeoutMs)));
      if (response.get("entries") != null) entries = response.get("entries");
    } catch (Exception ignored) {
      // The entries stay as they were; the bindings are already patched.
    }
  }

  public Object close() {
    closed = true;
    return Map.of("closed", true);
  }

  private Map<String, Object> snapshotBindings() {
    Map<String, Object> out = new LinkedHashMap<>(bindings);
    for (String name : reserved.keySet()) out.remove(name);
    int maxBytes = intOption(runtimePolicy.get("maxSnapshotBytes"), 262144);
    if (Json.stringify(out).getBytes(java.nio.charset.StandardCharsets.UTF_8).length > maxBytes) {
      Map<String, Object> trimmed = new LinkedHashMap<>();
      for (Map.Entry<String, Object> entry : out.entrySet()) {
        trimmed.put(entry.getKey(), entry.getValue());
        if (Json.stringify(trimmed).getBytes(java.nio.charset.StandardCharsets.UTF_8).length > maxBytes) {
          trimmed.remove(entry.getKey());
          trimmed.put("__ax_snapshot_truncated", true);
          return trimmed;
        }
      }
    }
    return out;
  }

  private static int intOption(Object value, int fallback) {
    if (value instanceof Number n) return Math.max(1, n.intValue());
    if (value instanceof String s) {
      try { return Math.max(1, Integer.parseInt(s)); } catch (NumberFormatException ignored) {}
    }
    return fallback;
  }

  private static boolean isHostCallable(Object value) {
    if (!(value instanceof Map<?, ?> map)) return false;
    return Boolean.TRUE.equals(map.get("__ax_host_callable"));
  }

  private static String errorCategory(Exception ex) {
    String text = String.valueOf(ex.getMessage()).toLowerCase();
    if (text.contains("timeout") || text.contains("timed out") || text.contains("interrupted")) return "timeout";
    return "runtime";
  }

  private String callHost(String name, String paramsJson) {
    AxQuickJsHostCallable handler = hostCallables.get(name);
    if (handler == null) {
      return Json.stringify(Map.of("ok", false, "category", "runtime", "error", "unknown QuickJS host callable: " + name));
    }
    try {
      Object params = paramsJson == null || paramsJson.isBlank() ? null : Json.parse(paramsJson);
      Object result = handler.call(params);
      return Json.stringify(Map.of("ok", true, "result", result == null ? Map.of() : result));
    } catch (Exception ex) {
      return Json.stringify(Map.of("ok", false, "category", errorCategory(ex), "error", ex.getMessage() == null ? "QuickJS host callable failed" : ex.getMessage()));
    }
  }

  private record HostCall(String name, String params, java.util.concurrent.CompletableFuture<String> result) {}

  private String runQuickJs(String payloadJson, int timeoutMs) throws Exception {
    var calls = new java.util.concurrent.LinkedBlockingQueue<HostCall>();
    var finished = new java.util.concurrent.CompletableFuture<String>();
    var accepting = new java.util.concurrent.atomic.AtomicBoolean(true);
    Thread engineWorker = new Thread(() -> {
      try {
        Builtins hostBuiltins = Builtins.builder("axir_host")
          .add(new HostFunction("__ax_host_call", List.of(String.class, String.class), String.class, args -> {
            var call = new HostCall(String.valueOf(args.get(0)), String.valueOf(args.get(1)), new java.util.concurrent.CompletableFuture<>());
            synchronized (calls) {
              if (!accepting.get()) throw new IllegalStateException("QuickJS invocation is closed");
              calls.add(call);
            }
            return call.result().join();
          }))
          .build();
        Engine engine = Engine.builder().addInvokables(INVOKABLES).addBuiltins(hostBuiltins).build();
        String output;
        try (Runner runner = Runner.builder().withEngine(engine).withTimeoutMs(timeoutMs).build()) {
          output = String.valueOf(runner.invokeGuestFunction("axir", "__ax_run", List.of(payloadJson), RUNTIME_SUPPORT + "\n" + QUICKJS_SOURCE));
        }
        finished.complete(output);
      } catch (Throwable failure) {
        finished.completeExceptionally(failure);
      }
    }, "ax-quickjs-engine");
    engineWorker.setDaemon(true);
    engineWorker.start();
    long deadline = System.nanoTime() + java.util.concurrent.TimeUnit.MILLISECONDS.toNanos(timeoutMs);
    try {
      while (!finished.isDone()) {
        if (System.nanoTime() >= deadline) throw new java.util.concurrent.TimeoutException("QuickJS execution timed out");
        HostCall call = calls.poll(10, java.util.concurrent.TimeUnit.MILLISECONDS);
        if (call != null) {
          // All agent state and borrowed clients stay on the execute() caller.
          try { call.result().complete(callHost(call.name(), call.params())); }
          catch (Throwable failure) { call.result().completeExceptionally(failure); }
        }
      }
      return finished.get();
    } finally {
      synchronized (calls) {
        accepting.set(false);
        HostCall call;
        while ((call = calls.poll()) != null) {
          call.result().completeExceptionally(new IllegalStateException("QuickJS invocation is closed"));
        }
      }
      engineWorker.interrupt();
    }
  }

  // TypeScript's action-log code analysis and AxJSRuntime snapshot entries,
  // shared by the ports' JavaScript runtimes (scripts/axir-runtime-support.mjs).
  private static final String RUNTIME_SUPPORT = "// Generated by scripts/axir-runtime-support.mjs from\n// src/ax/util/jsAnalysis.ts, src/ax/agent/contextManager.ts and\n// src/ax/funcs/worker.runtime.ts. Do not edit by hand.\n(function () {\nfunction isIdentifierChar(ch) {\n  return !!ch && /[A-Za-z0-9_$]/.test(ch);\n}\nfunction isIdentifierStart(ch) {\n  return !!ch && /[A-Za-z_$]/.test(ch);\n}\nfunction stripJsStringsAndComments(code) {\n  var _a, _b;\n  let out = \"\";\n  let i = 0;\n  let state = \"normal\";\n  let escaped = false;\n  while (i < code.length) {\n    const ch = (_a = code[i]) != null ? _a : \"\";\n    const next = (_b = code[i + 1]) != null ? _b : \"\";\n    if (state === \"lineComment\") {\n      if (ch === \"\\n\") {\n        out += \"\\n\";\n        state = \"normal\";\n      } else {\n        out += \" \";\n      }\n      i++;\n      continue;\n    }\n    if (state === \"blockComment\") {\n      if (ch === \"*\" && next === \"/\") {\n        out += \"  \";\n        i += 2;\n        state = \"normal\";\n      } else {\n        out += ch === \"\\n\" ? \"\\n\" : \" \";\n        i++;\n      }\n      continue;\n    }\n    if (state === \"single\" || state === \"double\" || state === \"template\") {\n      const quote = state === \"single\" ? \"'\" : state === \"double\" ? '\"' : \"`\";\n      if (escaped) {\n        out += ch === \"\\n\" ? \"\\n\" : \" \";\n        escaped = false;\n        i++;\n        continue;\n      }\n      if (ch === \"\\\\\") {\n        out += \" \";\n        escaped = true;\n        i++;\n        continue;\n      }\n      if (ch === quote) {\n        out += \" \";\n        state = \"normal\";\n        i++;\n        continue;\n      }\n      out += ch === \"\\n\" ? \"\\n\" : \" \";\n      i++;\n      continue;\n    }\n    if (ch === \"/\" && next === \"/\") {\n      out += \"  \";\n      i += 2;\n      state = \"lineComment\";\n      continue;\n    }\n    if (ch === \"/\" && next === \"*\") {\n      out += \"  \";\n      i += 2;\n      state = \"blockComment\";\n      continue;\n    }\n    if (ch === \"'\") {\n      out += \" \";\n      i++;\n      state = \"single\";\n      continue;\n    }\n    if (ch === '\"') {\n      out += \" \";\n      i++;\n      state = \"double\";\n      continue;\n    }\n    if (ch === \"`\") {\n      out += \" \";\n      i++;\n      state = \"template\";\n      continue;\n    }\n    out += ch;\n    i++;\n  }\n  return out;\n}\nfunction extractTopLevelDeclaredNames(code) {\n  const names = [];\n  const len = code.length;\n  let i = 0;\n  let braceDepth = 0;\n  let parenDepth = 0;\n  const skipString = (quote) => {\n    i++;\n    if (quote === \"`\") {\n      let templateDepth = 0;\n      while (i < len) {\n        const ch = code[i];\n        if (ch === \"\\\\\") {\n          i += 2;\n          continue;\n        }\n        if (templateDepth > 0) {\n          if (ch === \"{\") {\n            templateDepth++;\n          } else if (ch === \"}\") {\n            templateDepth--;\n          }\n          i++;\n          continue;\n        }\n        if (ch === \"$\" && i + 1 < len && code[i + 1] === \"{\") {\n          templateDepth++;\n          i += 2;\n          continue;\n        }\n        if (ch === \"`\") {\n          i++;\n          return;\n        }\n        i++;\n      }\n      return;\n    }\n    while (i < len) {\n      const ch = code[i];\n      if (ch === \"\\\\\") {\n        i += 2;\n        continue;\n      }\n      if (ch === quote) {\n        i++;\n        return;\n      }\n      i++;\n    }\n  };\n  const skipLineComment = () => {\n    i += 2;\n    while (i < len && code[i] !== \"\\n\") {\n      i++;\n    }\n  };\n  const skipBlockComment = () => {\n    i += 2;\n    while (i < len) {\n      if (code[i] === \"*\" && i + 1 < len && code[i + 1] === \"/\") {\n        i += 2;\n        return;\n      }\n      i++;\n    }\n  };\n  const readWord = () => {\n    const start = i;\n    while (i < len && isIdentifierChar(code[i])) {\n      i++;\n    }\n    return code.slice(start, i);\n  };\n  const skipWhitespace = () => {\n    const start = i;\n    while (i < len) {\n      const ch = code[i];\n      if (ch === \" \" || ch === \"\t\" || ch === \"\\n\" || ch === \"\\r\") {\n        i++;\n        continue;\n      }\n      if (ch === \"/\" && i + 1 < len) {\n        if (code[i + 1] === \"/\") {\n          skipLineComment();\n          continue;\n        }\n        if (code[i + 1] === \"*\") {\n          skipBlockComment();\n          continue;\n        }\n      }\n      break;\n    }\n    return i > start;\n  };\n  const extractDestructuredNames = (close) => {\n    let depth = 1;\n    while (i < len && depth > 0) {\n      skipWhitespace();\n      if (i >= len) return;\n      const ch = code[i];\n      if (ch === close) {\n        depth--;\n        i++;\n        continue;\n      }\n      if (ch === \"{\" || ch === \"[\") {\n        const nestedClose = ch === \"{\" ? \"}\" : \"]\";\n        i++;\n        extractDestructuredNames(nestedClose);\n        continue;\n      }\n      if (ch === \".\" && i + 2 < len && code[i + 1] === \".\" && code[i + 2] === \".\") {\n        i += 3;\n        skipWhitespace();\n        if (i < len && isIdentifierChar(code[i])) {\n          const name = readWord();\n          if (name) names.push(name);\n        }\n        continue;\n      }\n      if (ch === \",\") {\n        i++;\n        continue;\n      }\n      if (ch === \"=\") {\n        i++;\n        let eqDepth = 0;\n        while (i < len) {\n          const current = code[i];\n          if (current === \"'\" || current === '\"' || current === \"`\") {\n            skipString(current);\n            continue;\n          }\n          if (current === \"(\" || current === \"[\" || current === \"{\") {\n            eqDepth++;\n            i++;\n            continue;\n          }\n          if (current === \")\" || current === \"]\" || current === \"}\") {\n            if (eqDepth > 0) {\n              eqDepth--;\n              i++;\n              continue;\n            }\n            break;\n          }\n          if (current === \",\" && eqDepth === 0) {\n            break;\n          }\n          i++;\n        }\n        continue;\n      }\n      if (isIdentifierChar(ch)) {\n        const word = readWord();\n        skipWhitespace();\n        if (i < len && code[i] === \":\") {\n          i++;\n          skipWhitespace();\n          if (i < len) {\n            const current = code[i];\n            if (current === \"{\" || current === \"[\") {\n              const nestedClose = current === \"{\" ? \"}\" : \"]\";\n              i++;\n              extractDestructuredNames(nestedClose);\n            } else if (isIdentifierChar(current)) {\n              const renamed = readWord();\n              if (renamed) names.push(renamed);\n            }\n          }\n        } else if (word) {\n          names.push(word);\n        }\n        continue;\n      }\n      i++;\n    }\n  };\n  const skipToCommaOrEnd = () => {\n    let depth = 0;\n    while (i < len) {\n      const ch = code[i];\n      if (ch === \"'\" || ch === '\"' || ch === \"`\") {\n        skipString(ch);\n        continue;\n      }\n      if (ch === \"/\" && i + 1 < len) {\n        if (code[i + 1] === \"/\") {\n          skipLineComment();\n          continue;\n        }\n        if (code[i + 1] === \"*\") {\n          skipBlockComment();\n          continue;\n        }\n      }\n      if (ch === \"(\" || ch === \"[\" || ch === \"{\") {\n        depth++;\n        i++;\n        continue;\n      }\n      if (ch === \")\" || ch === \"]\" || ch === \"}\") {\n        if (depth > 0) {\n          depth--;\n          i++;\n          continue;\n        }\n        return false;\n      }\n      if (ch === \",\" && depth === 0) {\n        i++;\n        return true;\n      }\n      if (ch === \";\" && depth === 0) {\n        i++;\n        return false;\n      }\n      if (ch === \"\\n\" && depth === 0) {\n        const savedIndex = i;\n        i++;\n        skipWhitespace();\n        if (i < len && code[i] === \",\") {\n          i++;\n          return true;\n        }\n        i = savedIndex;\n        return false;\n      }\n      i++;\n    }\n    return false;\n  };\n  const extractBindings = () => {\n    while (i < len) {\n      skipWhitespace();\n      if (i >= len) return;\n      const ch = code[i];\n      if (ch === \"{\") {\n        i++;\n        extractDestructuredNames(\"}\");\n        if (!skipToCommaOrEnd()) return;\n        continue;\n      }\n      if (ch === \"[\") {\n        i++;\n        extractDestructuredNames(\"]\");\n        if (!skipToCommaOrEnd()) return;\n        continue;\n      }\n      if (isIdentifierChar(ch)) {\n        const name = readWord();\n        if (name) names.push(name);\n        if (!skipToCommaOrEnd()) return;\n        continue;\n      }\n      return;\n    }\n  };\n  const isStatementBoundary = (pos) => {\n    if (pos === 0) return true;\n    let j = pos - 1;\n    while (j >= 0) {\n      const ch = code[j];\n      if (ch === \" \" || ch === \"\t\" || ch === \"\\r\") {\n        j--;\n        continue;\n      }\n      return ch === \"\\n\" || ch === \";\" || ch === \"{\" || ch === \"}\";\n    }\n    return true;\n  };\n  while (i < len) {\n    const ch = code[i];\n    if (ch === \"'\" || ch === '\"' || ch === \"`\") {\n      skipString(ch);\n      continue;\n    }\n    if (ch === \"/\" && i + 1 < len) {\n      if (code[i + 1] === \"/\") {\n        skipLineComment();\n        continue;\n      }\n      if (code[i + 1] === \"*\") {\n        skipBlockComment();\n        continue;\n      }\n    }\n    if (ch === \"{\") {\n      braceDepth++;\n      i++;\n      continue;\n    }\n    if (ch === \"}\") {\n      braceDepth--;\n      i++;\n      continue;\n    }\n    if (ch === \"(\") {\n      parenDepth++;\n      i++;\n      continue;\n    }\n    if (ch === \")\") {\n      parenDepth--;\n      i++;\n      continue;\n    }\n    if (braceDepth === 0 && parenDepth === 0 && isIdentifierChar(ch)) {\n      const wordStart = i;\n      const word = readWord();\n      if ((word === \"var\" || word === \"let\" || word === \"const\") && i < len && (code[i] === \" \" || code[i] === \"\t\" || code[i] === \"\\n\") && isStatementBoundary(wordStart)) {\n        extractBindings();\n      }\n      continue;\n    }\n    i++;\n  }\n  const seen = /* @__PURE__ */ new Set();\n  const unique = [];\n  for (const name of names) {\n    if (!seen.has(name)) {\n      seen.add(name);\n      unique.push(name);\n    }\n  }\n  return unique;\n}\nfunction extractTopLevelDurableWriteTargets(code) {\n  const names = new Set(extractTopLevelDeclaredNames(code));\n  const sanitized = stripJsStringsAndComments(code);\n  const len = sanitized.length;\n  let i = 0;\n  let braceDepth = 0;\n  let parenDepth = 0;\n  const skipWhitespace = (index) => {\n    var _a;\n    let current = index;\n    while (current < len && /\\s/.test((_a = sanitized[current]) != null ? _a : \"\")) {\n      current++;\n    }\n    return current;\n  };\n  const previousNonWhitespaceIndex = (index) => {\n    var _a;\n    let current = index;\n    while (current >= 0 && /\\s/.test((_a = sanitized[current]) != null ? _a : \"\")) {\n      current--;\n    }\n    return current;\n  };\n  const isAssignmentOperatorAt = (index) => {\n    const threeChars = sanitized.slice(index, index + 3);\n    const twoChars = sanitized.slice(index, index + 2);\n    if (threeChars === \"===\" || twoChars === \"==\" || twoChars === \"=>\") {\n      return false;\n    }\n    return sanitized[index] === \"=\" || [\n      \"+=\",\n      \"-=\",\n      \"*=\",\n      \"/=\",\n      \"%=\",\n      \"&=\",\n      \"|=\",\n      \"^=\",\n      \"&&=\",\n      \"||=\",\n      \"??=\",\n      \"**=\",\n      \"<<=\",\n      \">>=\",\n      \">>>=\"\n    ].some((op) => sanitized.startsWith(op, index));\n  };\n  const readWord = (start) => {\n    let nextIndex = start;\n    while (nextIndex < len && isIdentifierChar(sanitized[nextIndex])) {\n      nextIndex++;\n    }\n    return { word: sanitized.slice(start, nextIndex), nextIndex };\n  };\n  const addIfBareAssignment = (word, start, end) => {\n    const prevIndex = previousNonWhitespaceIndex(start - 1);\n    const prev = prevIndex >= 0 ? sanitized[prevIndex] : void 0;\n    const nextIndex = skipWhitespace(end);\n    const isMemberAccess = prev === \".\" || prev === \"?\";\n    if (isMemberAccess) {\n      return;\n    }\n    const hasPrefixUpdate = sanitized.slice(Math.max(0, start - 2), start) === \"++\" || sanitized.slice(Math.max(0, start - 2), start) === \"--\";\n    const hasSuffixUpdate = sanitized.startsWith(\"++\", nextIndex) || sanitized.startsWith(\"--\", nextIndex);\n    if (hasPrefixUpdate || hasSuffixUpdate || isAssignmentOperatorAt(nextIndex)) {\n      names.add(word);\n    }\n  };\n  const addIfGlobalAssignment = (start, end) => {\n    const dotIndex = skipWhitespace(end);\n    if (sanitized[dotIndex] !== \".\") {\n      return;\n    }\n    const nameStart = skipWhitespace(dotIndex + 1);\n    if (!isIdentifierStart(sanitized[nameStart])) {\n      return;\n    }\n    const { word: propertyName, nextIndex } = readWord(nameStart);\n    const operatorIndex = skipWhitespace(nextIndex);\n    const hasPrefixUpdate = sanitized.slice(Math.max(0, start - 2), start) === \"++\" || sanitized.slice(Math.max(0, start - 2), start) === \"--\";\n    const hasSuffixUpdate = sanitized.startsWith(\"++\", operatorIndex) || sanitized.startsWith(\"--\", operatorIndex);\n    if (propertyName && (hasPrefixUpdate || hasSuffixUpdate || isAssignmentOperatorAt(operatorIndex))) {\n      names.add(propertyName);\n    }\n  };\n  while (i < len) {\n    const ch = sanitized[i];\n    if (ch === \"{\") {\n      braceDepth++;\n      i++;\n      continue;\n    }\n    if (ch === \"}\") {\n      braceDepth--;\n      i++;\n      continue;\n    }\n    if (ch === \"(\") {\n      parenDepth++;\n      i++;\n      continue;\n    }\n    if (ch === \")\") {\n      parenDepth--;\n      i++;\n      continue;\n    }\n    if (braceDepth === 0 && parenDepth === 0 && isIdentifierStart(ch)) {\n      const start = i;\n      const { word, nextIndex } = readWord(i);\n      i = nextIndex;\n      if (!word) {\n        continue;\n      }\n      if (word === \"globalThis\") {\n        addIfGlobalAssignment(start, nextIndex);\n        continue;\n      }\n      addIfBareAssignment(word, start, nextIndex);\n      continue;\n    }\n    i++;\n  }\n  return [...names];\n}\nconst JS_KEYWORDS = new Set([\n  'var', 'let', 'const', 'function', 'return', 'if', 'else', 'for', 'while',\n  'do', 'switch', 'case', 'break', 'continue', 'try', 'catch', 'finally',\n  'throw', 'new', 'delete', 'typeof', 'void', 'in', 'of', 'instanceof',\n  'this', 'class', 'extends', 'super', 'import', 'export', 'default', 'from',\n  'as', 'async', 'await', 'yield', 'true', 'false', 'null', 'undefined',\n  'console', 'log'\n]);\nfunction extractReferencedIdentifiers(code) {\n  const sanitized = stripJsStringsAndComments(code);\n  const identRegex = /\\b([a-zA-Z_$][a-zA-Z0-9_$]*)\\b/g;\n  const ids = new Set();\n  let match = identRegex.exec(sanitized);\n  while (match !== null) {\n    if (match[1] && !JS_KEYWORDS.has(match[1])) {\n      ids.add(match[1]);\n    }\n    match = identRegex.exec(sanitized);\n  }\n  return ids;\n}\nfunction extractReadIdentifiers(code) {\n  const reads = extractReferencedIdentifiers(code);\n  for (const declared of extractTopLevelDeclaredNames(code)) {\n    reads.delete(declared);\n  }\n  return reads;\n}\nfunction extractDirectQualifiedCallableUsages(code) {\n  const sanitized = stripJsStringsAndComments(code);\n  const usages = new Set();\n  const callPattern = /\\b([a-zA-Z_$][a-zA-Z0-9_$]*)\\.([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*\\(/g;\n  let match = callPattern.exec(sanitized);\n  while (match) {\n    const namespace = match[1];\n    const name = match[2];\n    if (namespace && name) {\n      usages.add(namespace + '.' + name);\n    }\n    match = callPattern.exec(sanitized);\n  }\n  return [...usages];\n}\nconst truncateInspectText = (text, maxChars) =>\n  text.length <= maxChars ? text : text.slice(0, maxChars - 3) + '...';\nconst previewInspectAtom = (value) => {\n  if (value === null) {\n    return 'null';\n  }\n  if (value === undefined) {\n    return 'undefined';\n  }\n  const valueType = typeof value;\n  if (typeof value === 'string') {\n    return JSON.stringify(truncateInspectText(value, 40));\n  }\n  if (valueType === 'number' || valueType === 'boolean' || valueType === 'bigint') {\n    return String(value);\n  }\n  if (valueType === 'symbol') {\n    return String(value);\n  }\n  if (valueType === 'function') {\n    const fnName = value.name && typeof value.name === 'string' ? value.name : '';\n    return '[function ' + (fnName || 'anonymous') + ']';\n  }\n  if (Array.isArray(value)) {\n    return '[array(' + value.length + ')]';\n  }\n  if (value instanceof Date) {\n    return Number.isFinite(value.getTime()) ? value.toISOString() : String(value);\n  }\n  if (value instanceof Error) {\n    return (value.name || 'Error') + ': ' + (value.message || '');\n  }\n  if (typeof Map !== 'undefined' && value instanceof Map) {\n    return '[map(' + value.size + ')]';\n  }\n  if (typeof Set !== 'undefined' && value instanceof Set) {\n    return '[set(' + value.size + ')]';\n  }\n  const ctorName =\n    value && typeof value === 'object' && 'constructor' in value && value.constructor &&\n    typeof value.constructor.name === 'string'\n      ? value.constructor.name\n      : '';\n  return ctorName && ctorName !== 'Object' ? '[' + ctorName + ']' : '[object]';\n};\nconst describeInspectType = (value) => {\n  if (value === null) {\n    return { type: 'null' };\n  }\n  if (Array.isArray(value)) {\n    return { type: 'array', ctor: 'Array' };\n  }\n  if (typeof Map !== 'undefined' && value instanceof Map) {\n    return { type: 'map', ctor: 'Map' };\n  }\n  if (typeof Set !== 'undefined' && value instanceof Set) {\n    return { type: 'set', ctor: 'Set' };\n  }\n  if (value instanceof Date) {\n    return { type: 'date', ctor: 'Date' };\n  }\n  if (value instanceof Error) {\n    return {\n      type: 'error',\n      ctor: typeof value.name === 'string' && value.name.trim() ? value.name : 'Error',\n    };\n  }\n  const valueType = typeof value;\n  if (valueType !== 'object') {\n    return { type: valueType };\n  }\n  const ctor =\n    value && typeof value === 'object' && 'constructor' in value && value.constructor &&\n    typeof value.constructor.name === 'string'\n      ? value.constructor.name\n      : undefined;\n  return { type: 'object', ctor };\n};\nconst describeInspectSize = (value, type) => {\n  if (type === 'string') {\n    return value.length + ' chars';\n  }\n  if (type === 'array') {\n    return value.length + ' items';\n  }\n  if (type === 'map' || type === 'set') {\n    return value.size + ' items';\n  }\n  if (type === 'object' && value && typeof value === 'object') {\n    return Object.keys(value).length + ' keys';\n  }\n  return undefined;\n};\nconst previewInspectValue = (value, type, ctor) => {\n  if (type === 'array') {\n    const items = value.slice(0, 3).map((item) => previewInspectAtom(item));\n    return '[' + items.join(', ') + (value.length > 3 ? ', ...' : '') + ']';\n  }\n  if (type === 'map') {\n    const items = Array.from(value.entries())\n      .slice(0, 3)\n      .map((pair) => previewInspectAtom(pair[0]) + ' => ' + previewInspectAtom(pair[1]));\n    return 'Map(' + value.size + ') {' + items.join(', ') + (value.size > 3 ? ', ...' : '') + '}';\n  }\n  if (type === 'set') {\n    const items = Array.from(value.values())\n      .slice(0, 5)\n      .map((item) => previewInspectAtom(item));\n    return 'Set(' + value.size + ') {' + items.join(', ') + (value.size > 5 ? ', ...' : '') + '}';\n  }\n  if (type === 'date' || type === 'error' || type === 'function') {\n    return previewInspectAtom(value);\n  }\n  if (type === 'object' && value && typeof value === 'object') {\n    const keys = Object.keys(value);\n    const shown = keys.slice(0, 4);\n    const prefix = ctor && ctor !== 'Object' ? ctor + ' ' : '';\n    return prefix + '{' + shown.join(', ') + (keys.length > shown.length ? ', ...' : '') + '}';\n  }\n  return previewInspectAtom(value);\n};\nconst canCloneValue = (value, seen) => {\n  const valueType = typeof value;\n  if (valueType === 'function' || valueType === 'symbol') {\n    return false;\n  }\n  if (value === null || valueType !== 'object') {\n    return true;\n  }\n  if (seen.indexOf(value) >= 0) {\n    return true;\n  }\n  seen.push(value);\n  if (value instanceof Date || value instanceof RegExp || value instanceof Error) {\n    return true;\n  }\n  if (typeof Map !== 'undefined' && value instanceof Map) {\n    for (const pair of value.entries()) {\n      if (!canCloneValue(pair[0], seen) || !canCloneValue(pair[1], seen)) return false;\n    }\n    return true;\n  }\n  if (typeof Set !== 'undefined' && value instanceof Set) {\n    for (const item of value.values()) {\n      if (!canCloneValue(item, seen)) return false;\n    }\n    return true;\n  }\n  for (const key of Object.keys(value)) {\n    if (!canCloneValue(value[key], seen)) return false;\n  }\n  return true;\n};\nglobalThis.__ax_analyze_code = function (code) {\n  const text = typeof code === 'string' ? code : '';\n  return JSON.stringify({\n    producedVars: extractTopLevelDurableWriteTargets(text),\n    readVars: [...extractReadIdentifiers(text)],\n    callables: extractDirectQualifiedCallableUsages(text),\n  });\n};\n// src/ax/agent/agentInternal/sharedSession.ts buildDistillerFinalWrapperCode:\n// in the distiller phase, final(task, evidence) with an evidence object\n// keeps it as the distilledContext global, which the executor inherits with\n// the session. The runtime calls this after installing its final primitive;\n// a merge patch (the executor phase) sets __ax_phase to 'executor'.\nglobalThis.__ax_install_final_evidence = function () {\n  const hostFinal = globalThis.final;\n  if (typeof hostFinal !== 'function' || hostFinal.__ax_final_evidence === true) {\n    return;\n  }\n  const wrapped = function () {\n    const context = arguments[1];\n    if (\n      globalThis.__ax_phase !== 'executor' &&\n      arguments.length === 2 &&\n      context !== null &&\n      typeof context === 'object' &&\n      !Array.isArray(context)\n    ) {\n      globalThis.distilledContext = context;\n    }\n    return hostFinal.apply(this, arguments);\n  };\n  wrapped.__ax_final_evidence = true;\n  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'final') || {};\n  try {\n    if (descriptor.configurable === false) {\n      globalThis.final = wrapped;\n    } else {\n      Object.defineProperty(globalThis, 'final', {\n        value: wrapped,\n        writable: descriptor.writable !== false,\n        enumerable: descriptor.enumerable === true,\n        configurable: true,\n      });\n    }\n  } catch (_error) {\n    // A final the runtime cannot replace keeps its behavior.\n  }\n};\nglobalThis.__ax_inspect_entries = function (skipNames) {\n  const skip = new Set(Array.isArray(skipNames) ? skipNames : []);\n  const scope = globalThis;\n  const entries = Object.getOwnPropertyNames(scope)\n    .filter((name) => !skip.has(name) && !name.startsWith('_'))\n    .sort()\n    .map((name) => {\n      try {\n        const descriptor = Object.getOwnPropertyDescriptor(scope, name);\n        if (!descriptor) {\n          return undefined;\n        }\n        if ('get' in descriptor && typeof descriptor.get === 'function' && !('value' in descriptor)) {\n          return { name, type: 'accessor', preview: '[getter omitted]', restorable: false };\n        }\n        const value = 'value' in descriptor ? descriptor.value : scope[name];\n        const meta = describeInspectType(value);\n        const size = describeInspectSize(value, meta.type);\n        const preview = previewInspectValue(value, meta.type, meta.ctor);\n        const entry = { name, type: meta.type };\n        if (meta.ctor) entry.ctor = meta.ctor;\n        if (size) entry.size = size;\n        if (preview) entry.preview = truncateInspectText(preview, 96);\n        entry.restorable = canCloneValue(value, []);\n        return entry;\n      } catch (_error) {\n        return { name, type: 'unknown', preview: '[unavailable]', restorable: false };\n      }\n    })\n    .filter((entry) => entry !== undefined);\n  return JSON.stringify(entries);\n};\n})();\n";

  private static final String QUICKJS_SOURCE = """
var __ax_host_namespaces = Object.create(null);
function __ax_bind_host_namespaces() {
  const roots = [];
  for (const name of Object.getOwnPropertyNames(globalThis)) {
    if (name.indexOf('.') < 0) continue;
    const callable = Object.getOwnPropertyDescriptor(globalThis, name);
    if (!callable || typeof callable.value !== 'function') continue;
    const parts = name.split('.');
    if (parts.some(part => !part)) {
      throw new Error('Invalid host callable namespace: ' + name);
    }
    let target = globalThis;
    let path = '';
    for (let index = 0; index < parts.length - 1; index++) {
      const part = parts[index];
      path += (index ? '.' : '') + part;
      let entry = Object.getOwnPropertyDescriptor(target, part);
      if (!entry) {
        const value = Object.create(null);
        Object.defineProperty(target, part, {value, enumerable: true});
        __ax_host_namespaces[path] = value;
        entry = {value};
      }
      if (entry.value !== __ax_host_namespaces[path]) {
        throw new Error('Host callable namespace conflicts with a global: ' + path);
      }
      target = entry.value;
    }
    const leaf = parts[parts.length - 1];
    const existing = Object.getOwnPropertyDescriptor(target, leaf);
    if (existing && existing.value !== callable.value) {
      throw new Error('Host callable name conflicts with a namespace: ' + name);
    }
    if (!existing) Object.defineProperty(target, leaf, {value: callable.value, enumerable: true});
    if (roots.indexOf(parts[0]) < 0) roots.push(parts[0]);
  }
  if (Array.isArray(globalThis.__ax_session_reserved)) {
    for (const root of roots) {
      if (globalThis.__ax_session_reserved.indexOf(root) < 0) globalThis.__ax_session_reserved.push(root);
    }
  }
  return roots;
}

// Persistence: top-level const/let/var declared this turn are block-scoped to the async
// wrapper and would vanish next turn, but the RLM prompt promises a long-running REPL.
// Extract the declared names so they can be assigned onto globalThis (which persists),
// mirroring the TS runtime. Fail-open.
function axPersistSuffix(src){try{var n=[],s={},re=/(?:^|[\\n;{}])\\s*(?:export\\s+)?(?:async\\s+)?(?:function|class|const|let|var)\\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,m;while((m=re.exec(src))){if(!s[m[1]]){s[m[1]]=1;n.push(m[1]);}}return n.map(function(x){return 'try{globalThis['+JSON.stringify(x)+']='+x+';}catch(__e){}';}).join('');}catch(__e){return '';}}
async function __ax_run(payloadJson) {
  const payload = JSON.parse(payloadJson || "{}");
  // The globals present before the bindings: the snapshot entries leave them
  // out, as TS's AxJSRuntime does.
  const baseline = Object.getOwnPropertyNames(globalThis);
  let analysis = null;
  try { analysis = JSON.parse(globalThis.__ax_analyze_code(payload.code || "")); } catch (_) {}
  const reserved = new Set([
    "Object", "Function", "Array", "Number", "parseFloat", "parseInt", "Infinity", "NaN",
    "undefined", "Boolean", "String", "Symbol", "Date", "Promise", "RegExp", "Error",
    "AggregateError", "EvalError", "RangeError", "ReferenceError", "SyntaxError", "TypeError",
    "URIError", "globalThis", "JSON", "Math", "Reflect", "Proxy", "eval", "isFinite",
    "isNaN", "decodeURI", "decodeURIComponent", "encodeURI", "encodeURIComponent",
    "console", "Javy", "plugin", "main", "quickjs4j_engine", "axir", "axir_host",
    "final", "respond", "askClarification", "discover", "recall", "used", "reportSuccess",
    "reportFailure", "guideAgent"
  ]);
  function isHostCallable(value) {
    return value && typeof value === "object" && value.__ax_host_callable === true;
  }
  function cloneJson(value) {
    if (value === undefined) return null;
    return JSON.parse(JSON.stringify(value));
  }
  function hostCallableError(message, category) {
    const error = new Error(String(message || "host callable failed"));
    error.error_category = String(category || "runtime");
    return error;
  }
  function makeHostCallable(name, spec) {
    return function(params) {
      if (spec.native === true) {
        const response = JSON.parse(axir_host.__ax_host_call(name, JSON.stringify(params === undefined ? null : params)));
        if (response.ok) return response.result;
        throw hostCallableError(response.error || ("host callable failed: " + name), response.category);
      }
      if (spec.error) {
        throw hostCallableError(spec.error.message || spec.error.error || ("host callable failed: " + name), spec.error.category);
      }
      if (Object.prototype.hasOwnProperty.call(spec, "result")) return cloneJson(spec.result);
      return {kind: "result", result: null};
    };
  }
  for (const [key, value] of Object.entries(payload.bindings || {})) {
    if (!key.startsWith("__ax_") && (!reserved.has(key) || isHostCallable(value))) {
      globalThis[key] = isHostCallable(value) ? makeHostCallable(key, value) : value;
    }
  }
  for (const name of __ax_bind_host_namespaces()) reserved.add(name);
  function complete(value) { globalThis.__ax_completion = value; return value; }
  globalThis.final = function() { return complete({type: "final", args: Array.from(arguments)}); };
  globalThis.respond = function() { return complete({type: "respond", args: Array.from(arguments)}); };
  globalThis.askClarification = function() { return complete({type: "askClarification", args: Array.from(arguments)}); };
  globalThis.discover = function(request) { return complete({kind: "discover", discover: request}); };
  globalThis.recall = function(request) { return complete({kind: "recall", recall: request}); };
  globalThis.used = function(idOrRequest, reason) {
    const payload = (idOrRequest && typeof idOrRequest === "object") ? Object.assign({}, idOrRequest) : {id: idOrRequest};
    if (reason !== undefined && reason !== null) payload.reason = String(reason);
    return complete({kind: "used", used: payload});
  };
  globalThis.reportSuccess = function(message) {
    return complete({kind: "status", status: {type: "success", message: String(message || "")}});
  };
  globalThis.reportFailure = function(message) {
    return complete({kind: "status", status: {type: "failed", message: String(message || "")}});
  };
  globalThis.guideAgent = function(guidance) {
    return complete({type: "guide_agent", guidance: String(guidance || "")});
  };
  // TS's distiller final: final(task, evidence) keeps the evidence as the
  // distilledContext global the executor inherits.
  globalThis.__ax_phase = payload.phase || "distiller";
  globalThis.__ax_install_final_evidence();
  function snapshotEntries() {
    try {
      return JSON.parse(globalThis.__ax_inspect_entries(baseline.concat(Array.from(reserved), Array.isArray(payload.reserved) ? payload.reserved : [])));
    } catch (_) {
      return [];
    }
  }
  if (payload.inspect === true) {
    return JSON.stringify({ok: true, result: null, bindings: {}, entries: snapshotEntries()});
  }
  let result;
  try {
    // RLM actor code uses top-level await (`await final(...)`), illegal in a plain Function
    // body; compile it as an async function so await is legal, and await it so the whole body
    // runs to completion. Without the await a synchronous `throw` becomes an unhandled rejected
    // promise that the surrounding try/catch never sees, silently dropping error_category;
    // awaiting surfaces both synchronous throws and post-await rejections as runtime errors
    // here. quickjs4j resolves this guest function's returned promise before handing the result
    // back to the host, mirroring the libquickjs/py-quickjs engines that drain the job queue.
    await (async function(){}).constructor("with (globalThis) { " + (payload.code || "") + "\\n" + axPersistSuffix(payload.code || "") + "\\n}")();
    result = globalThis.__ax_completion;
  } catch (error) {
    return JSON.stringify({ok: false, category: String((error && (error.error_category || error.category)) || "runtime"), error: String((error && error.message) || error), analysis});
  }
  const out = {};
  for (const key of Object.getOwnPropertyNames(globalThis)) {
    if (reserved.has(key) || key.startsWith("__ax_")) continue;
    const value = globalThis[key];
    if (typeof value === "function" || typeof value === "undefined") continue;
    try { JSON.stringify(value); out[key] = value; } catch (_) {}
  }
  return JSON.stringify({ok: true, result, bindings: out, entries: snapshotEntries(), analysis});
}
""";
}
