// ax-example:start
// title: Java Native Google Gemini Decisions
// group: generation
// description: Evaluate named yes/no, choice and score questions with native probabilities and confidence.
// provider: google-gemini-decisions
// env: GEMINI_API_KEY, GOOGLE_API_KEY, GOOGLE_APIKEY
// level: intermediate
// order: 48
// ax-example:end
import dev.axllm.ax.*;
import java.util.*;
public final class GoogleGeminiDecisionsNativeExample {
  public static void main(String[] args) throws Exception {
    String key = System.getenv("GEMINI_API_KEY");
    if (key == null) key = System.getenv("GOOGLE_API_KEY");
    if (key == null) key = System.getenv("GOOGLE_APIKEY");
    if (key == null) throw new IllegalStateException("Set a Google API key.");
    var client = Ax.googleGeminiDecisions(Map.of("apiKey", key));
    var result = client.create((Map<String,Object>) Json.parse("""
{"input": "Checkout is unavailable for all customers after the latest deployment.", "questions": {"urgent": {"type": "noul", "instructions": "Are customers unable to complete a core task?"}, "team": {"type": "choice", "instructions": "Which team should investigate?", "criteria": {"support": "Usage guidance", "billing": "Individual invoice disputes", "engineering": "Broken functionality or service outages"}}, "severity": {"type": "score", "instructions": "How severe is the customer impact?", "criteria": ["Minor inconvenience", "Feature impaired", "Core task blocked"]}}}
"""));
    System.out.println(Json.stringify(result));
  }
}
