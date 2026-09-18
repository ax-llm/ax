// ax-example:start
// title: Java Jev Hybrid Reply
// group: generation
// description: Passes Jev decisions to a second Ax program to generate a customer reply.
// provider: typesafe, openai
// env: TYPESAFE_APIKEY, OPENAI_APIKEY, OPENAI_API_KEY
// level: intermediate
// order: 37
// ax-example:end
import dev.axllm.ax.*;
import java.util.*;

public final class TypesafeHybridExample {
  public static void main(String[] args) throws Exception {
    var model = Ax.ai("typesafe", Map.of("apiKey", System.getenv("TYPESAFE_APIKEY"), "trueThreshold", 0.9));
    var triage = Ax.ax("ticket:string -> urgent:boolean(true \"Customers cannot complete a core task\", false \"Routine request\") \"Needs immediate attention?\", team:class \"support, billing, engineering\"");
    var decision = triage.forward(model, Map.of("ticket", "Checkout is unavailable for all customers after the latest deployment."));
    if (!(decision.get("urgent") instanceof Boolean) || !Set.of("support", "billing", "engineering").contains(decision.get("team"))) throw new AssertionError("Invalid decision");
    var key = System.getenv().getOrDefault("OPENAI_API_KEY", System.getenv("OPENAI_APIKEY"));
    var writer = Ax.ai("openai", Map.of("apiKey", key, "model", "gpt-5.6-luna", "model_config", Map.of("temperature", 1)));
    var inputs = new LinkedHashMap<String,Object>(decision);
    inputs.put("ticket", "Checkout is unavailable for all customers after the latest deployment.");
    var reply = Ax.ax("ticket:string, urgent:boolean, team:string -> reply:string").forward(writer, inputs);
    if (!(reply.get("reply") instanceof String text) || text.isBlank()) throw new AssertionError("Empty reply");
    System.out.println(Json.stringify(Map.of("decision", decision, "reply", reply)));
  }
}
