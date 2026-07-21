// ax-example:start
// title: Java Signature Constraints
// group: generation
// description: Builds a constrained signature fluently and runs it with OpenAI.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 40
// ax-example:end
import dev.axllm.ax.*;
import java.util.*;

public final class SignatureConstraintsExample {
  static String apiKey() {
    String apiKey = System.getenv("OPENAI_API_KEY");
    if (apiKey == null || apiKey.isBlank()) apiKey = System.getenv("OPENAI_APIKEY");
    if (apiKey == null || apiKey.isBlank()) {
      throw new IllegalStateException("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.");
    }
    return apiKey;
  }

  static OpenAICompatibleClient client() {
    return new OpenAICompatibleClient(
        Map.of(
            "api_key", apiKey(),
            "model", System.getenv().getOrDefault("AX_OPENAI_MODEL", "gpt-5.4-mini"),
            "model_config", Map.of("temperature", 0.0)));
  }

  public static void main(String[] args) throws Exception {
    AxSignature signature =
        Ax.f()
            .call()
            .input("requestText", Ax.f().string("Booking request").min(10).max(500))
            .input("contactEmail", Ax.f().string("Contact email").email())
            .output("partySize", Ax.f().number("Guests").min(1).max(12))
            .output(
                "bookingCode",
                Ax.f()
                    .string("Three letters, a dash, and four digits")
                    .regex("^[A-Z]{3}-\\d{4}$", "Must look like ABC-1234"))
            .output(
                "guestProfile",
                Ax.f()
                    .object(
                        Map.of(
                            "fullName", Ax.f().string("Primary guest").min(2),
                            "dietaryNotes",
                                Ax.f().string("Dietary requirements").optional())))
            .build();
    Map<String, Object> output =
        Ax.ax(signature)
            .forward(
                client(),
                Map.of(
                    "requestText",
                    "Book dinner for four people under the name Ada Lovelace.",
                    "contactEmail",
                    "ada@example.com"));
    System.out.println(Json.stringify(output));
  }
}
