// ax-example:start
// title: Java Audio Summary Pipeline
// group: audio
// description: Transcribes audio and summarizes the transcript with an OpenAI-backed generator.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 30
// ax-example:end
import dev.axllm.ax.*;
import java.nio.file.*;
import java.util.*;
import java.util.Base64;

public final class PipelineAudioExample {
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
        Map.of("api_key", apiKey(), "model", System.getenv().getOrDefault("AX_OPENAI_MODEL", "gpt-4.1-mini"), "model_config", Map.of("temperature", 0.0)));
  }

  public static void main(String[] args) throws Exception {
    OpenAIResponsesClient audio = client();
    String wav = Base64.getEncoder().encodeToString(Files.readAllBytes(Path.of("src/examples/assets/presentation.wav")));
    Map<String, Object> transcript = audio.transcribe(Map.of("audio", wav, "language", "en", "model", "gpt-4o-mini-transcribe", "format", "json"));
    AxGen summarize = Ax.ax("transcript:string -> summary:string, followUps:string[]");
    Map<String, Object> result = summarize.forward(new OpenAICompatibleClient(Map.of("api_key", apiKey(), "model", System.getenv().getOrDefault("AX_OPENAI_MODEL", "gpt-4.1-mini"), "model_config", Map.of("temperature", 0.0))), Map.of("transcript", transcript.get("text")));
    System.out.println(Json.stringify(Map.of("transcript", transcript.get("text"), "result", result)));
  }
}
