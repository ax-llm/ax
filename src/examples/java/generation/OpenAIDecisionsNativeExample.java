// ax-example:start
// title: Java OpenAI Native Decisions
// group: generation
// description: Uses ordered predicate, choice, and score questions with explicit rubrics and raw probabilities.
// provider: openai-decisions
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 45
// ax-example:end
import dev.axllm.ax.*;
import java.util.*;
public final class OpenAIDecisionsNativeExample {
 public static void main(String[] args) throws Exception {
  var client = Ax.openaiDecisions(Map.of("apiKey", Optional.ofNullable(System.getenv("OPENAI_API_KEY")).orElse(System.getenv("OPENAI_APIKEY"))));
  var request = (Map<String, Object>) Json.parse("""
{"input": "Checkout is unavailable for all customers after the latest deployment.", "questions": [{"type": "predicate", "name": "urgent", "instructions": "Are customers unable to complete a core task?"}, {"type": "choice", "name": "team", "instructions": "Who should handle the ticket?", "choices": [{"value": "support", "description": "Usage guidance"}, {"value": "billing", "description": "Invoices and payments"}, {"value": "engineering", "description": "Product failures"}]}, {"type": "score", "name": "severity", "instructions": "Rate customer impact", "levels": [{"label": "Minor inconvenience"}, {"label": "One task blocked"}, {"label": "Core task unavailable"}, {"label": "Widespread outage"}]}]}
""");
  var response = client.create(request);
  // Handle per-question refusals before using probability, choice, or score.
  if (((List<?>) response.get("answers")).size() != 3) throw new AssertionError("Missing answers");
  System.out.println(Json.stringify(response));
 }
}
