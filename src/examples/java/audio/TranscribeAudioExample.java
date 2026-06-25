// ax-example:start
// title: Java Speech To Text
// group: audio
// description: Transcribes a checked-in WAV file through OpenAI.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 20
// ax-example:end
import dev.axllm.ax.*;
import java.nio.file.*;
import java.util.*;
import java.util.Base64;

public final class TranscribeAudioExample {
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
    String wav = Base64.getEncoder().encodeToString(Files.readAllBytes(Path.of("src/examples/assets/presentation.wav")));
    Map<String, Object> transcript = audio.transcribe(Map.of("audio", wav, "language", "en", "model", "gpt-4o-mini-transcribe", "format", "json"));
    System.out.println(Json.stringify(transcript));
  }
}
