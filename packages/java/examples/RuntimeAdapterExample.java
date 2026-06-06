import dev.axllm.ax.*;
import java.util.*;

public final class RuntimeAdapterExample {
  @SuppressWarnings("unchecked")
  static Map<String, Object> asMap(Object value) {
    return value instanceof Map<?, ?> ? (Map<String, Object>) value : new LinkedHashMap<>();
  }

  static final class DemoRuntime implements AxCodeRuntime {
    final AxRuntimeCapabilities capabilities = new AxRuntimeCapabilities().language("Python").snapshot(true).patch(true);
    final List<DemoSession> sessions = new ArrayList<>();

    public String language() { return "Python"; }
    public AxCodeSession createSession(Map<String, Object> globals, Map<String, Object> options) {
      DemoSession session = new DemoSession(globals, options);
      sessions.add(session);
      return session;
    }
  }

  static final class DemoSession implements AxCodeSession {
    Map<String, Object> globals;
    final Map<String, Object> createOptions;
    boolean closed = false;

    DemoSession(Map<String, Object> globals, Map<String, Object> options) {
      this.globals = new LinkedHashMap<>(globals == null ? Map.of() : globals);
      this.createOptions = new LinkedHashMap<>(options == null ? Map.of() : options);
    }

    public Object execute(String code, Map<String, Object> options) {
      if (options == null || !options.containsKey("reservedNames")) throw new RuntimeException("missing reservedNames");
      if ("timeout()".equals(code)) return AxRuntimeEnvelope.timeout("demo timeout");
      globals.put("answer", "runtime");
      return AxRuntimeEnvelope.finalPayload(Map.of("answer", globals.get("answer")));
    }

    public Object inspectGlobals(Map<String, Object> options) { return new LinkedHashMap<>(globals); }
    public Object snapshotGlobals(Map<String, Object> options) { return Map.of("version", 1, "bindings", new LinkedHashMap<>(globals), "globals", new LinkedHashMap<>(globals), "closed", closed); }
    public Object patchGlobals(Object snapshot, Map<String, Object> options) {
      globals = new LinkedHashMap<>(asMap(asMap(snapshot).get("bindings")));
      return snapshotGlobals(options);
    }
    public Object close() { closed = true; return Map.of("closed", true); }
  }

  public static void main(String[] args) {
    DemoRuntime runtime = new DemoRuntime();
    AxAgent qa = Ax.agent("question:string -> answer:string", Map.of("runtime", Map.of("language", "Python")));
    Map<String, Object> out = qa.test(runtime, "final()", Map.of("question", "adapter"));
    if (!"final".equals(out.get("kind"))) throw new RuntimeException("bad test output: " + out);
    if (!runtime.sessions.get(runtime.sessions.size() - 1).closed) throw new RuntimeException("test session was not closed");

    AxAgent runner = Ax.agent("question:string -> answer:string", Map.of("runtime", Map.of("language", "Python")));
    Map<String, Object> step = runner.executeActorStep(runtime, "final()", Map.of("question", "adapter"));
    if (!"final".equals(step.get("kind"))) throw new RuntimeException("bad step output: " + step);
    Map<String, Object> snapshot = asMap(runner.exportSessionState());
    runner.restoreSessionState(snapshot);
    Map<String, Object> timeout = runner.executeActorStep(runtime, "timeout()", Map.of("question", "adapter"));
    if (!"timeout".equals(timeout.get("error_category"))) throw new RuntimeException("bad timeout: " + timeout);
    System.out.println("java-runtime-adapter-ok");
  }
}
