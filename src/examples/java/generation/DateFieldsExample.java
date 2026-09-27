// ax-example:start
// title: Java Date Fields
// group: generation
// description: Parses date, datetime and range outputs into ISO 8601 as TypeScript does with parseDates, and passes a java.time value as an input.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 47
// ax-example:end
import dev.axllm.ax.*;
import java.time.Instant;
import java.util.*;

public final class DateFieldsExample {
  public static void main(String[] args) {
    String apiKey = System.getenv("OPENAI_API_KEY");
    if (apiKey == null || apiKey.isBlank()) apiKey = System.getenv("OPENAI_APIKEY");
    if (apiKey == null || apiKey.isBlank()) throw new IllegalStateException("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.");
    AxAIService client = Ax.ai("openai", Map.of(
        "api_key", apiKey,
        "model", System.getenv().getOrDefault("AX_OPENAI_MODEL", "gpt-5.4-mini")));

    // parseDates reads the date-typed outputs as TypeScript does: an IANA
    // zone, an offset or an abbreviation at its literal offset, then
    // toISOString text. Without it (the default until the next major
    // version) they keep the model's text.
    AxGen planner = new AxGen(
        AxSignature.create(
            "emailText:string, sentAt:datetime -> meetingStartsAt:datetime \"Start time with its time zone\", "
                + "meetingDay:date, travelWindow:dateRange \"First and last day away\""),
        Map.of("parseDates", true));
    Map<String, Object> out = planner.forward(client, Map.of(
        "emailText", "Can we meet next Tuesday at 3pm New York time? I'm travelling from the 8th to the 12th.",
        // A java.time value is rendered as TypeScript renders a Date.
        "sentAt", Instant.parse("2024-05-02T16:30:00Z")));
    System.out.println(out.get("meetingStartsAt")); // e.g. 2024-05-07T19:00:00.000Z
    System.out.println(out.get("meetingDay")); // e.g. 2024-05-07T00:00:00.000Z
    System.out.println(out.get("travelWindow")); // {start=2024-05-08T00:00:00.000Z, end=...}
  }
}
