package dev.axllm.ax;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

/**
 * A live, evolving context playbook bound to a program. Mirrors the TypeScript
 * {@code AxPlaybook}: grow it offline from examples ({@link #evolve}), keep it
 * growing online from live feedback ({@link #update}), render it into the program
 * context ({@link #applyTo}), and persist/restore it ({@link #toJson}/{@link
 * #load}). The evolution engine (ACE) is hidden behind this surface, just as
 * {@code Ax.optimize} hides GEPA.
 */
public final class AxPlaybook {
  private static final String REFLECTOR_SIGNATURE =
      "question:string \"Original task input serialized as JSON\", "
          + "generator_answer:string \"Generator output serialized as JSON\", "
          + "generator_reasoning?:string \"Generator reasoning trace\", "
          + "playbook:string \"Current context playbook rendered as markdown\", "
          + "expected_answer?:string \"Expected output when ground truth is available\", "
          + "feedback?:string \"External feedback or reward signal\", "
          + "previous_reflection?:string \"Most recent reflection JSON when running multi-round refinement\" "
          + "-> reasoning:string \"Step-by-step analysis of generator performance\", "
          + "errorIdentification:string \"Specific mistakes detected\", "
          + "rootCauseAnalysis:string \"Underlying cause of the error\", "
          + "correctApproach:string \"What the generator should do differently\", "
          + "keyInsight:string \"Reusable insight to remember\", "
          + "bulletTags:json \"Array of {id, tag} entries referencing playbook bullets\"";
  private static final String CURATOR_SIGNATURE =
      "playbook:string \"Current playbook serialized as JSON\", "
          + "reflection:string \"Latest reflection output serialized as JSON\", "
          + "question_context:string \"Original task input serialized as JSON\", "
          + "token_budget?:number \"Approximate token budget for curator response\" "
          + "-> reasoning:string \"Justification for the proposed updates\", "
          + "operations:json \"List of operations with type/section/content fields\"";

  private final AxGen program;
  private final AxACE engine;
  private final AiClient studentAI;
  private final AiClient teacherAI;
  private final boolean verbose;
  private final String baseInstruction;
  private boolean started = false;
  private java.util.function.Consumer<String> applyHook;
  private AxGen reflectorProgram;
  private AxGen curatorProgram;
  private Object lastPrediction;

  public AxPlaybook(AxGen program, Map<String, Object> options) {
    Map<String, Object> opts = options == null ? Map.of() : options;
    this.program = program;
    Object student = option(opts, "studentAI", "student_ai", "student", "client", "ai");
    if (!(student instanceof AiClient studentClient)) {
      throw new IllegalArgumentException("playbook() requires studentAI or client");
    }
    this.studentAI = studentClient;
    Object teacher = option(opts, "teacherAI", "teacher_ai", "teacher");
    this.teacherAI = teacher instanceof AiClient teacherClient ? teacherClient : studentClient;
    this.verbose = Boolean.TRUE.equals(opts.get("verbose"));

    Map<String, Object> engineOptions = new LinkedHashMap<>();
    putIfPresent(engineOptions, "now", opts.get("now"));
    putIfPresent(engineOptions, "maxEpochs", option(opts, "maxEpochs", "max_epochs"));
    putIfPresent(engineOptions, "maxReflectorRounds", option(opts, "maxReflectorRounds", "max_reflector_rounds"));
    putIfPresent(engineOptions, "maxSectionSize", option(opts, "maxSectionSize", "max_section_size"));
    putIfPresent(engineOptions, "allowDynamicSections", option(opts, "allowDynamicSections", "allow_dynamic_sections"));
    putIfPresent(engineOptions, "initialPlaybook", option(opts, "initialPlaybook", "initial_playbook"));
    this.engine = new AxACE(this::runReflector, this::runCurator, this::runGenerator, engineOptions);
    Object auto = opts.get("auto");
    if (auto != null) {
      this.engine.configureAuto(String.valueOf(auto));
    }
    this.baseInstruction = program == null ? null : program.getInstruction();
  }

  // The real LLM generator: run the bound program with the student client.
  private Map<String, Object> runGenerator(Map<String, Object> example) {
    if (this.program == null) {
      return new LinkedHashMap<>();
    }
    inject();
    Map<String, Object> prediction = this.program.forward(this.studentAI, example);
    this.lastPrediction = prediction;
    return prediction;
  }

  private AxGen reflector() {
    if (this.reflectorProgram == null) {
      this.reflectorProgram = Ax.ax(REFLECTOR_SIGNATURE);
    }
    return this.reflectorProgram;
  }

  private AxGen curator() {
    if (this.curatorProgram == null) {
      this.curatorProgram = Ax.ax(CURATOR_SIGNATURE);
    }
    return this.curatorProgram;
  }

  // The real LLM reflector: a focused AxGen sub-program driven by the teacher.
  private Map<String, Object> runReflector(Map<String, Object> payload) {
    Map<String, Object> request = new LinkedHashMap<>();
    request.put("question", stringify(payload.get("question")));
    request.put("generator_answer", stringify(payload.get("generator_answer")));
    request.put("playbook", payload.get("playbook"));
    putIfPresent(request, "generator_reasoning", payload.get("generator_reasoning"));
    putIfPresent(request, "feedback", payload.get("feedback"));
    if (payload.get("previous_reflection") != null) {
      request.put("previous_reflection", stringify(payload.get("previous_reflection")));
    }
    try {
      return reflector().forward(this.teacherAI, request);
    } catch (RuntimeException e) {
      if (this.verbose) {
        System.out.println("[AxPlaybook] reflector error: " + e.getMessage());
      }
      return null;
    }
  }

  // The real LLM curator: a focused AxGen sub-program driven by the teacher.
  private Map<String, Object> runCurator(Map<String, Object> payload) {
    Map<String, Object> request = new LinkedHashMap<>();
    request.put("playbook", payload.get("playbook"));
    request.put("reflection", stringify(payload.get("reflection")));
    request.put("question_context", stringify(payload.get("question_context")));
    request.put("token_budget", payload.getOrDefault("token_budget", 1024));
    try {
      return curator().forward(this.teacherAI, request);
    } catch (RuntimeException e) {
      if (this.verbose) {
        System.out.println("[AxPlaybook] curator error: " + e.getMessage());
      }
      return null;
    }
  }

  /**
   * Grow the playbook offline from labeled examples, scoring each rollout with
   * {@code metricFn} ({@code {"prediction", "example"}}), then render the result
   * into the bound program.
   */
  public Map<String, Object> evolve(List<Object> examples, Function<Map<String, Object>, Object> metricFn, Map<String, Object> options) {
    Map<String, Object> opts = options == null ? Map.of() : options;
    Object auto = opts.get("auto");
    if (auto != null) {
      this.engine.configureAuto(String.valueOf(auto));
    }
    Map<String, Object> aceOptions = new LinkedHashMap<>();
    putIfPresent(aceOptions, "maxEpochs", option(opts, "maxEpochs", "max_epochs"));
    Function<Map<String, Object>, Object> wrappedMetric = example -> {
      if (metricFn == null) {
        return 0;
      }
      Map<String, Object> args = new LinkedHashMap<>();
      args.put("prediction", this.lastPrediction);
      args.put("example", example);
      return metricFn.apply(args);
    };
    Map<String, Object> result = this.engine.compile(this.program, examples == null ? List.of() : examples, wrappedMetric, Map.of("aceOptions", aceOptions));
    this.started = true;
    inject();
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("bestScore", result.get("bestScore"));
    out.put("playbook", result.get("playbook"));
    return out;
  }

  /**
   * Refine the playbook online from a single live interaction. Safe to call
   * without a prior {@link #evolve}/{@link #load}; the bound program is hydrated
   * lazily on first use.
   */
  public Map<String, Object> update(Map<String, Object> args) {
    if (!this.started) {
      Map<String, Object> state = new LinkedHashMap<>();
      state.put("baseInstruction", this.baseInstruction);
      state.put("playbook", this.engine.getPlaybook());
      this.engine.hydrate(this.program, state);
      this.started = true;
    }
    Map<String, Object> result = this.engine.applyOnlineUpdate(args == null ? Map.of() : args);
    inject();
    return result;
  }

  /** Render the current playbook into a program context (defaults to the bound program). */
  public void applyTo(AxGen target) {
    if (target != null && target != this.program) {
      target.setInstruction(composeInstruction(target.getInstruction(), render()));
      return;
    }
    inject();
  }

  /** The current playbook rendered as a markdown block. */
  public String render() {
    return String.valueOf(Core._ace_render_playbook(this.engine.getPlaybook()));
  }

  /** A serializable snapshot of the current playbook and its history. */
  public Map<String, Object> getState() {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("playbook", this.engine.getPlaybook());
    out.put("artifact", this.engine.getArtifact());
    return out;
  }

  /** Alias of {@link #getState}. */
  public Map<String, Object> toJson() {
    return getState();
  }

  /** Restore a snapshot into this handle and render it into the bound program. */
  public AxPlaybook load(Map<String, Object> snapshot) {
    Map<String, Object> snap = snapshot == null ? Map.of() : snapshot;
    Map<String, Object> state = new LinkedHashMap<>();
    state.put("baseInstruction", this.baseInstruction);
    state.put("playbook", snap.get("playbook"));
    state.put("artifact", snap.get("artifact"));
    this.engine.hydrate(this.program, state);
    this.started = true;
    inject();
    return this;
  }

  /** Set the evolution intensity preset. */
  public void configureAuto(String level) {
    this.engine.configureAuto(level);
  }

  /** Clear the playbook back to its initial state. */
  public void reset() {
    this.engine.reset();
    this.started = false;
  }

  /** @hidden Used by {@code AxAgent.playbook()} to redirect injection into a stage. */
  public void setApplyHook(java.util.function.Consumer<String> hook) {
    this.applyHook = hook;
  }

  private void inject() {
    String rendered = render();
    if (this.applyHook != null) {
      this.applyHook.accept(rendered);
      return;
    }
    if (this.program != null) {
      String base = this.baseInstruction == null ? this.program.getInstruction() : this.baseInstruction;
      this.program.setInstruction(composeInstruction(base, rendered));
    }
  }

  static String composeInstruction(String base, String rendered) {
    List<String> parts = new ArrayList<>();
    if (base != null && !base.trim().isEmpty()) {
      parts.add(base.trim());
    }
    if (rendered != null && !rendered.trim().isEmpty()) {
      parts.add(rendered.trim());
    }
    return String.join("\n\n", parts);
  }

  private static String stringify(Object value) {
    if (value == null) {
      return "";
    }
    if (value instanceof String s) {
      return s;
    }
    return Json.stringify(value);
  }

  private static void putIfPresent(Map<String, Object> target, String key, Object value) {
    if (value != null) {
      target.put(key, value);
    }
  }

  static Object option(Map<String, Object> options, String... keys) {
    for (String key : keys) {
      if (options.containsKey(key) && options.get(key) != null) {
        return options.get(key);
      }
    }
    return null;
  }

  /** Create an evolving context {@link AxPlaybook} for a program. */
  public static AxPlaybook playbook(AxGen program, Map<String, Object> options) {
    return new AxPlaybook(program, options);
  }
}
