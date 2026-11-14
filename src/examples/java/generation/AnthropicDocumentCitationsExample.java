// ax-example:start
// title: Java Anthropic Document Citations
// group: generation
// description: Preserve source locations and output passages through ordinary and streaming generation.
// provider: anthropic
// env: ANTHROPIC_API_KEY, ANTHROPIC_APIKEY
// level: intermediate
// order: 48
// ax-example:end
import dev.axllm.ax.*;
import java.util.*;

public final class AnthropicDocumentCitationsExample {
  public static void main(String[] args) throws Exception {
    String key = System.getenv("ANTHROPIC_API_KEY");
    if (key == null || key.isBlank()) key = System.getenv("ANTHROPIC_APIKEY");
    if (key == null || key.isBlank()) throw new IllegalStateException("Set ANTHROPIC_API_KEY.");
    var client = Ax.ai("anthropic", Map.of("api_key", key, "model", "claude-haiku-5-5"));
    for (boolean stream : new boolean[]{false, true}) {
      var program = Ax.ax("doc:file -> answer:string \"State the opening year and closed day, citing the supplied document.\"");
      var answer = program.forward(client, Map.of("doc", Map.of(
          "source", Map.of("type", "text", "data", "The museum opened in 1984. It is closed on Mondays."),
          "title", "Museum notes", "citations", Map.of("enabled", true))), Map.of("stream", stream));
      var log = program.getChatLog();
      System.out.println(Json.stringify(Map.of("stream", stream, "answer", answer,
          "text_blocks", log.get(log.size() - 1).get("text_blocks"))));
    }
  }
}
