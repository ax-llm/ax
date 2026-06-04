import dev.axllm.ax.*;
import java.util.*;

public final class FlowLiveOpenAIExample {
  public static void main(String[] args) throws Exception {
    String apiKey = System.getenv("OPENAI_API_KEY");
    if (apiKey == null || apiKey.isBlank()) apiKey = System.getenv("OPENAI_APIKEY");
    if (apiKey == null || apiKey.isBlank()) {
      throw new IllegalStateException("Set OPENAI_API_KEY or OPENAI_APIKEY to run this live example.");
    }
    String model = System.getenv().getOrDefault("AX_LIVE_MODEL", "gpt-4.1-mini");
    OpenAICompatibleClient client =
        new OpenAICompatibleClient(
            Map.of("api_key", apiKey, "model", model, "model_config", Map.of("temperature", 0.0)));

    AxGen outline = Ax.ax("topic:string -> outline:string");
    AxFlow program =
        Ax.flow(Map.of("id", "examples.liveFlow"))
            .execute("outline", outline)
            .map(
                "summary",
                state -> Map.of("summary", "Generated outline with typed Ax program steps."))
            .returns(Map.of("outline", "outline", "summary", "summary"));
    Map<String, Object> output =
        program.forward(client, Map.of("topic", "how Ax composes typed LLM programs"));
    System.out.println(Json.stringify(output));
  }
}
