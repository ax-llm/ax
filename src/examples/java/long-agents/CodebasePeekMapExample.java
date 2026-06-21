// ax-example:start
// title: Java Codebase Q&A with a Peek Context Map
// group: long-agents
// description: Answers several dependency questions over one large module index by building and reusing an evolving context map (the "peek" orientation cache), so later questions skip re-scanning the corpus.
// provider: google-gemini
// env: GOOGLE_APIKEY
// level: advanced
// order: 20
// ax-example:end
import dev.axllm.ax.*;
import dev.axllm.ax.runtime.quickjs.*;
import java.util.*;

public final class CodebasePeekMapExample {
  static GoogleGeminiClient client() {
    String apiKey = System.getenv("GOOGLE_APIKEY");
    if (apiKey == null || apiKey.isBlank()) {
      throw new IllegalStateException("Set GOOGLE_APIKEY to run this example.");
    }
    return new GoogleGeminiClient(Map.of(
        "api_key", apiKey,
        "model", System.getenv().getOrDefault("AX_GEMINI_MODEL", "gemini-3.5-flash")));
  }

  // ---------------------------------------------------------------------------
  // A large module-dependency index for a monorepo. Each block is a record the
  // agent must *search* to answer -- the answers cannot be guessed, only computed
  // by filtering the index. Generated large so it would not fit comfortably in a
  // prompt; it lives in contextFields and is queried from the runtime.
  // ---------------------------------------------------------------------------
  static List<Map<String, Object>> buildModuleIndex() {
    List<Map<String, Object>> core = new ArrayList<>(List.of(
        module("packages/api/middleware/auth.ts", List.of("packages/shared"), "-"),
        module("packages/api/middleware/rateLimit.ts", List.of("packages/db"), "-"),
        module("packages/api/routes/checkout.ts", List.of("packages/api/middleware/auth.ts", "packages/services/orders/createOrder.ts", "packages/services/payments/charge.ts"), "-"),
        module("packages/api/routes/search.ts", List.of("packages/api/middleware/auth.ts", "packages/services/catalog/searchCatalog.ts"), "-"),
        module("packages/services/orders/createOrder.ts", List.of("packages/db", "packages/clients/bus"), "orders"),
        module("packages/services/orders/orderRepo.ts", List.of("packages/db"), "orders"),
        module("packages/services/payments/charge.ts", List.of("packages/clients/acquirer", "packages/db"), "payments"),
        module("packages/services/payments/refund.ts", List.of("packages/clients/acquirer", "packages/db"), "refunds"),
        module("packages/services/catalog/searchCatalog.ts", List.of("packages/db"), "-"),
        module("packages/clients/acquirer/index.ts", List.of("packages/shared"), "-"),
        module("packages/clients/bus/index.ts", List.of("packages/shared"), "-")));

    // Filler modules so the index is genuinely large; some also depend on the acquirer.
    for (int i = 0; i < 110; i++) {
      core.add(module(
          "packages/services/feature" + i + "/handler.ts",
          List.of(i % 4 == 0 ? "packages/clients/acquirer" : "packages/db", "packages/shared"),
          i % 6 == 0 ? "audit" : "-"));
    }
    return core;
  }

  static Map<String, Object> module(String path, List<String> imports, String writes) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("path", path);
    m.put("imports", imports);
    m.put("writes", writes);
    return m;
  }

  @SuppressWarnings("unchecked")
  public static void main(String[] args) throws Exception {
    GoogleGeminiClient client = client();

    List<Map<String, Object>> modules = buildModuleIndex();
    StringBuilder sb = new StringBuilder();
    for (Map<String, Object> m : modules) {
      if (sb.length() > 0) sb.append("\n\n");
      sb.append("PATH: ").append(m.get("path")).append("\n")
        .append("IMPORTS: ").append(String.join(", ", (List<String>) m.get("imports"))).append("\n")
        .append("WRITES: ").append(m.get("writes"));
    }
    String codebaseIndex = sb.toString();
    System.out.println("Module index: " + modules.size() + " records (kept out of the prompt).");

    AxAgent analyst = Ax.agent(
        "context:string, question:string -> answer:string, paths:string[] \"Exact PATH values from the index that answer the question\"",
        Map.of(
            "contextFields", List.of("context"),
            "contextPolicy", Map.of("preset", "adaptive", "budget", "balanced"),
            "contextOptions", Map.of(
                "description", "The context is a module index of \"PATH / IMPORTS / WRITES\" records. Answer by filtering those records in code -- never guess. Return exact PATH values verbatim."),
            // The Peek context map: small, persistent orientation reused across queries.
            "contextMap", Map.of("maxChars", 1800, "infiniteEvolve", false, "evolveSteps", 1),
            "runtime", Map.of("language", "JavaScript")));

    List<String> questions = List.of(
        "Which modules import 'packages/clients/acquirer'? Give the exact PATH values.",
        "Which modules write to the 'orders' table?",
        "What are the direct IMPORTS of packages/api/routes/checkout.ts?");

    try (AxQuickJsCodeRuntime runtime = new AxQuickJsCodeRuntime()) {
      for (String question : questions) {
        Map<String, Object> result = analyst.forward(
            client,
            Map.of("context", codebaseIndex, "question", question),
            Map.of("runtime", runtime, "max_actor_steps", 24));
        System.out.println("\nQ: " + question);
        System.out.println("A: " + result.get("answer"));
        Object paths = result.get("paths");
        List<Object> pathList = paths instanceof List ? (List<Object>) paths : List.of();
        List<String> pathStrings = new ArrayList<>();
        for (Object p : pathList) pathStrings.add(String.valueOf(p));
        System.out.println("Paths: " + String.join(", ", pathStrings));
      }
    }

    System.out.println("\nThe context map evolved on the first query and was reused for the rest.");
  }
}
