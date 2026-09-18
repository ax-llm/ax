// ax-example:start
// title: Java Jev Native Questions
// group: generation
// description: Uses structured criteria, native scoring, model discovery, and probability-based decisions.
// provider: typesafe
// env: TYPESAFE_APIKEY
// level: advanced
// order: 36
// ax-example:end
import dev.axllm.ax.*;
import java.util.*;

public final class TypesafeNativeExample {
  public static void main(String[] args) throws Exception {
    var client = Ax.typesafe(Map.of("apiKey", System.getenv("TYPESAFE_APIKEY")));
    if (client.listModels().isEmpty()) throw new AssertionError("Empty model catalog");
    var account = new LinkedHashMap<String, Object>();
    account.put("tier", "enterprise");
    account.put("notes", null);
    var request = new AxAITypesafeClient.Request(
        Map.of("ticket", "Checkout is unavailable for all customers after the latest deployment.",
               "account", account),
        Map.of(
            "urgent", AxAITypesafeClient.Question.noul(
                Map.of("question", "Does this need immediate attention?"),
                Map.of("true", "Customers cannot complete a core task", "false", "Routine request")),
            "team", AxAITypesafeClient.Question.choice(
                "Who should handle the ticket?",
                Map.of("support", "Usage guidance",
                       "billing", Map.of("scope", "Invoices and payments"),
                       "engineering", "Product failures")),
            "severity", AxAITypesafeClient.Question.score(
                "Rate customer impact",
                List.of("Minor inconvenience", "One task blocked",
                        "Core task unavailable", "Widespread outage"))));
    var response = client.systemOne(request);
    double probability = ((AxAITypesafeClient.Noul) response.answers().get("urgent")).noul();
    double score = ((AxAITypesafeClient.Score) response.answers().get("severity")).score();
    if (probability < 0 || probability > 1 || score < 0 || score > 3) throw new AssertionError("Invalid answer bounds");
    // Apply thresholds and custom score scales in application code.
    System.out.println(Json.stringify(Map.of("page_on_call", probability >= 0.9, "severity_1_to_5", 1 + 4 * score / 3, "response", response.toMap())));
  }
}
