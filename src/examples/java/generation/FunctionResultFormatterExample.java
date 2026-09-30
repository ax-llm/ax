// ax-example:start
// title: Java Tool Result Formatting
// group: generation
// description: Formats a structured inventory tool result as concise text for the model.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 48
// ax-example:end
import dev.axllm.ax.*;
import java.util.Map;

public final class FunctionResultFormatterExample {
  public static void main(String[] args) {
    String key = System.getenv("OPENAI_API_KEY");
    if (key == null || key.isBlank()) key = System.getenv("OPENAI_APIKEY");
    if (key == null || key.isBlank()) throw new IllegalStateException("Set OPENAI_API_KEY or OPENAI_APIKEY.");
    var client = Ax.ai("openai", Map.of("api_key", key,
        "model", System.getenv().getOrDefault("AX_OPENAI_MODEL", "gpt-6-luna")));
    var inventory = Ax.fn("inventory").description("Read the current stock count.")
        .handler(values -> Map.of("available", 12, "warehouse", "A")).build();
    var program = Ax.ax("question:string -> answer:string").addTool(inventory);
    // The model receives this text; tool traces retain the original object.
    program.setFunctionResultFormatter(result -> ((Map<?, ?>) result).get("available") + " units available");
    var result = program.forward(client, Map.of("question", "Call inventory and report how many units are available."));
    System.out.println(result.get("answer"));
  }
}
