// ax-example:start
// title: Java OpenAI Signature Decisions
// group: generation
// description: Converts OpenAI probabilities into boolean and class outputs with a provider threshold.
// provider: openai-decisions
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: beginner
// order: 44
// ax-example:end
import dev.axllm.ax.*;
import java.util.*;

public final class OpenAIDecisionsExample {
  public static void main(String[] args) throws Exception {
    var model = Ax.ai("openai-decisions", Map.of("apiKey", Optional.ofNullable(System.getenv("OPENAI_API_KEY")).orElse(System.getenv("OPENAI_APIKEY")), "trueThreshold", 0.9));
    var triage = Ax.ax("ticket:string -> urgent:boolean(true \"Customers cannot complete a core task\", false \"Routine request\") \"Needs immediate attention?\", team:class \"support, billing, engineering\"");
    var decision = triage.forward(model, Map.of("ticket", "Checkout is unavailable for all customers after the latest deployment."));
    if (!(decision.get("urgent") instanceof Boolean) || !Set.of("support", "billing", "engineering").contains(decision.get("team"))) throw new AssertionError("Invalid decision");
    System.out.println(Json.stringify(decision));
  }
}
