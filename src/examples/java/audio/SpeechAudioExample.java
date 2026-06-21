// ax-example:start
// title: Java Text To Speech
// group: audio
// description: Generates speech audio through OpenAI.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: beginner
// order: 10
// story: 40
// ax-example:end
import dev.axllm.ax.*;
import java.nio.file.*;
import java.util.*;
import java.util.Base64;

public final class SpeechAudioExample {
  static String apiKey() {
    String apiKey = System.getenv("OPENAI_API_KEY");
    if (apiKey == null || apiKey.isBlank()) apiKey = System.getenv("OPENAI_APIKEY");
    if (apiKey == null || apiKey.isBlank()) {
      throw new IllegalStateException("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.");
    }
    return apiKey;
  }

  static OpenAIResponsesClient client() {
    return new OpenAIResponsesClient(
        Map.of("api_key", apiKey(), "model", System.getenv().getOrDefault("AX_OPENAI_MODEL", "gpt-5.4-mini"), "model_config", Map.of("temperature", 0.0)));
  }

  public static void main(String[] args) throws Exception {
    OpenAIResponsesClient audio = client();
    Map<String, Object> speech = audio.speak(Map.of("text", "Ax turns LLM prompts into typed programs.", "voice", "alloy", "format", "mp3"));
    System.out.println(Json.stringify(speech));
  }
}
