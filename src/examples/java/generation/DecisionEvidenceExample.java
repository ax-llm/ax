// ax-example:start
// title: Java Decision Evidence Reranking
// group: generation
// description: Ranks documents through Ax signatures while retaining decision evidence and candidate IDs.
// provider: openai-decisions
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 46
// ax-example:end
import dev.axllm.ax.*;
import java.util.*;

public final class DecisionEvidenceExample {
  public static void main(String[] args) throws Exception {
    var model = Ax.ai("openai-decisions", Map.of("apiKey", Optional.ofNullable(System.getenv("OPENAI_API_KEY")).orElse(System.getenv("OPENAI_APIKEY"))));
    var judge = Ax.ax("query:string, document:string -> relevant:boolean(evidence, threshold 0.7), relevance:score \"Irrelevant, Related, Partial answer, Direct answer\"(evidence)");
    var candidates = List.of(Map.of("id", "refund", "text", "Request a refund within 30 days through your account billing page."), Map.of("id", "password", "text", "Reset your password using the sign-in page."));
    var ranked = new ArrayList<Map<String,Object>>();
    for (var item : candidates) {
      var result = new LinkedHashMap<String,Object>(judge.forward(model, Map.of("query", "How do I request a refund?", "document", item.get("text"))));
      result.put("id", item.get("id")); ranked.add(result);
    }
    ranked.sort(Comparator.comparingDouble((Map<String,Object> item) -> ((Number)((Map<?,?>)item.get("relevance")).get("value")).doubleValue()).reversed());
    System.out.println(Json.stringify(ranked));
  }
}
