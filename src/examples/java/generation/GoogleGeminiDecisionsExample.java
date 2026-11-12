// ax-example:start
// title: Java Google Gemini Decision Evidence
// group: generation
// description: Classify a support ticket through signatures with native decision evidence.
// provider: google-gemini-decisions
// env: GEMINI_API_KEY, GOOGLE_API_KEY, GOOGLE_APIKEY
// level: intermediate
// order: 47
// ax-example:end
import dev.axllm.ax.*;
import java.util.*;
public final class GoogleGeminiDecisionsExample {
  public static void main(String[] args) throws Exception {
    String key = System.getenv("GEMINI_API_KEY");
    if (key == null) key = System.getenv("GOOGLE_API_KEY");
    if (key == null) key = System.getenv("GOOGLE_APIKEY");
    if (key == null) throw new IllegalStateException("Set a Google API key.");
    var model = Ax.ai("google-gemini-decisions", Map.of("apiKey", key));
    var triage = Ax.ax("ticket:string -> urgent:boolean(evidence, threshold 0.9) \"Does a core task fail for all customers?\", team:class \"support, billing, engineering\"(evidence) \"Which team should investigate?\", severity:score \"Minor inconvenience, Feature impaired, Core task blocked\"(evidence) \"How severe is the customer impact?\"");
    var result = triage.forward(model, Map.of("ticket", "Checkout is unavailable for all customers after the latest deployment."));
    System.out.println(Json.stringify(result));
  }
}
