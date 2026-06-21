// ax-example:start
// title: Java Multi-Model Panel
// group: short-agents
// description: Fans one question across three providers (OpenAI, Gemini, Anthropic), then judges the candidates and synthesizes a single grounded answer.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY, GOOGLE_APIKEY, ANTHROPIC_APIKEY
// level: advanced
// order: 40
// ax-example:end
import dev.axllm.ax.*;
import java.util.*;

public final class ModelPanelExample {
  static String firstNonBlank(String... values) {
    for (String value : values) {
      if (value != null && !value.isBlank()) return value;
    }
    return null;
  }

  public static void main(String[] args) throws Exception {
    String openaiKey = firstNonBlank(System.getenv("OPENAI_API_KEY"), System.getenv("OPENAI_APIKEY"));
    String googleKey = firstNonBlank(System.getenv("GOOGLE_APIKEY"), System.getenv("GOOGLE_API_KEY"));
    String anthropicKey = firstNonBlank(System.getenv("ANTHROPIC_APIKEY"), System.getenv("ANTHROPIC_API_KEY"));
    if (openaiKey == null || googleKey == null || anthropicKey == null) {
      throw new IllegalStateException(
          "Set OPENAI_APIKEY, GOOGLE_APIKEY, and ANTHROPIC_APIKEY to run this multi-provider panel.");
    }

    // A panel of three different providers, each answering the same question
    // independently. Plain ax() composition (no agent runtime): fan out to the
    // panel, judge the candidates, then synthesize one grounded answer.
    List<String> panelModels = List.of(
        "openai/gpt-5.4-mini",
        "google/gemini-3.5-flash",
        "anthropic/claude-haiku-4.5");
    List<AiClient> panelClients = List.of(
        new OpenAICompatibleClient(Map.of(
            "api_key", openaiKey, "model", "gpt-5.4-mini", "model_config", Map.of("temperature", 0.0))),
        new GoogleGeminiClient(Map.of(
            "api_key", googleKey, "model", "gemini-3.5-flash")),
        new AnthropicClient(Map.of(
            "api_key", anthropicKey, "model", "claude-haiku-4-5")));

    AxGen researcher = Ax.ax(
        "question:string -> answer:string, keyFindings:string[], citations:string[], confidence:number");
    researcher.setInstruction(
        "Answer independently. Use evidence. Call out uncertainty. Do not optimize for consensus.");

    AxGen judge = Ax.ax(
        "question:string, candidates:json -> consensus:string[], contradictions:string[], uniqueInsights:string[], blindSpots:string[]");
    judge.setInstruction(
        "Compare the candidates. Find agreement, conflicts, missing coverage, and unique useful points.");

    AxGen synthesizer = Ax.ax(
        "question:string, candidates:json, review:json -> answer:string, citations:string[], caveats:string[]");
    synthesizer.setInstruction(
        "Write one final answer grounded in the candidates and review. Resolve conflicts explicitly.");

    String question = "What are the strongest arguments for and against a national carbon tax?";

    List<Object> candidates = new ArrayList<>();
    for (int i = 0; i < panelClients.size(); i++) {
      Map<String, Object> response = researcher.forward(panelClients.get(i), Map.of("question", question));
      Map<String, Object> candidate = new LinkedHashMap<>();
      candidate.put("model", panelModels.get(i));
      candidate.putAll(response);
      candidates.add(candidate);
      System.out.println("[panel] " + panelModels.get(i) + " responded.");
    }

    // The judge + synthesizer run on one of the panel clients (OpenAI here).
    AiClient orchestrator = panelClients.get(0);
    Map<String, Object> review = judge.forward(orchestrator, Map.of("question", question, "candidates", candidates));
    Map<String, Object> finalAnswer = synthesizer.forward(
        orchestrator, Map.of("question", question, "candidates", candidates, "review", review));

    System.out.println(Json.pretty(finalAnswer));
  }
}
