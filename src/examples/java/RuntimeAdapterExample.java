import dev.axllm.ax.*;
import java.util.*;

public final class RuntimeAdapterExample {
  @SuppressWarnings("unchecked")
  static Map<String, Object> asMap(Object value) {
    return value instanceof Map<?, ?> ? (Map<String, Object>) value : new LinkedHashMap<>();
  }

  static final class DemoRuntime implements AxCodeRuntime {
    final List<DemoSession> sessions = new ArrayList<>();

    public String language() {
      return "Python";
    }

    public AxCodeSession createSession(Map<String, Object> globals, Map<String, Object> options) {
      DemoSession session = new DemoSession(globals);
      sessions.add(session);
      return session;
    }
  }

  static final class DemoSession implements AxCodeSession {
    Map<String, Object> globals;
    boolean closed = false;

    DemoSession(Map<String, Object> globals) {
      this.globals = new LinkedHashMap<>(globals == null ? Map.of() : globals);
    }

    public Object execute(String code, Map<String, Object> options) {
      if (options == null || !options.containsKey("reservedNames")) {
        throw new RuntimeException("reservedNames were not passed to the runtime");
      }
      if ("timeout()".equals(code)) return AxRuntimeEnvelope.timeout("demo timeout");
      globals.put("answer", "runtime final");
      return AxRuntimeEnvelope.finalPayload(Map.of("answer", globals.get("answer")));
    }

    public Object inspectGlobals(Map<String, Object> options) {
      return new LinkedHashMap<>(globals);
    }

    public Object snapshotGlobals(Map<String, Object> options) {
      return Map.of("version", 1, "bindings", new LinkedHashMap<>(globals), "closed", closed);
    }

    public Object patchGlobals(Object snapshot, Map<String, Object> options) {
      globals = new LinkedHashMap<>(asMap(asMap(snapshot).get("bindings")));
      return snapshotGlobals(options);
    }

    public Object close() {
      closed = true;
      return Map.of("closed", true);
    }
  }

  public static void main(String[] args) {
    DemoRuntime runtime = new DemoRuntime();
    AxAgent runner =
        Ax.agent("question:string -> answer:string", Map.of("runtime", Map.of("language", "Python")));
    Map<String, Object> step = runner.executeActorStep(runtime, "final()", Map.of("question", "adapter"));
    Object snapshot = runner.exportSessionState();
    runner.restoreSessionState(snapshot);
    Map<String, Object> timeout = runner.executeActorStep(runtime, "timeout()", Map.of("question", "adapter"));
    Object closed = runner.closeRuntimeSession();
    Map<String, Object> bindings = asMap(asMap(snapshot).get("bindings"));
    List<String> snapshotKeys = new ArrayList<>(bindings.keySet());
    Collections.sort(snapshotKeys);
    Map<String, Object> completionPayload = asMap(step.get("completion_payload"));

    System.out.println(
        Json.stringify(
            Map.of(
                "stepKind",
                step.get("kind"),
                "finalArgs",
                completionPayload.get("args"),
                "snapshotKeys",
                snapshotKeys,
                "snapshotAnswer",
                bindings.get("answer"),
                "timeoutCategory",
                timeout.get("error_category"),
                "closed",
                closed)));
  }
}
