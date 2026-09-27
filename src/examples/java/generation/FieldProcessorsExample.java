// ax-example:start
// title: Java Field Processor Feedback
// group: generation
// description: Sends a field processor's note back to the model for another step, as TypeScript does, and trims the final answer with a field transform.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 47
// ax-example:end
import dev.axllm.ax.*;
import java.util.*;

public final class FieldProcessorsExample {
  public static void main(String[] args) {
    String apiKey = System.getenv("OPENAI_API_KEY");
    if (apiKey == null || apiKey.isBlank()) apiKey = System.getenv("OPENAI_APIKEY");
    if (apiKey == null || apiKey.isBlank()) throw new IllegalStateException("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.");
    AxAIService client = Ax.ai("openai", Map.of(
        "api_key", apiKey,
        "model", System.getenv().getOrDefault("AX_OPENAI_MODEL", "gpt-5.4-mini")));
    AxGen summarize = Ax.ax("text:string -> summary:string");

    // With FEEDBACK a non-null result goes back to the model as a user
    // message, and the next step's answer replaces this one.
    summarize.addFieldProcessor("summary", (value, context) -> {
      int words = String.valueOf(value).trim().split("\\s+").length;
      return words > 12 ? "That summary has " + words + " words; answer again in at most 12 words." : null;
    }, AxFieldProcessorMode.FEEDBACK);
    summarize.addFieldTransform("summary", "trim");

    String text = "The committee met on Tuesday to review the budget. After a long debate about "
        + "the new library wing, they approved the plan and asked staff to find a builder "
        + "who can start in spring, while keeping the reading room open during the work.";
    System.out.println(summarize.forward(client, Map.of("text", text)).get("summary"));
  }
}
