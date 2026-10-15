// ax-example:start
// title: Java Jev Image Localization
// group: generation
// description: Locates a red square using image inputs and Box outputs with native confidence.
// provider: typesafe
// env: TYPESAFE_APIKEY
// level: intermediate
// order: 47
// ax-example:end
import dev.axllm.ax.*;
import java.nio.file.*;
import java.util.*;

public final class TypesafeImageBoxExample {
  public static void main(String[] args) throws Exception {
    var model = Ax.ai("typesafe", Map.of("apiKey", System.getenv("TYPESAFE_APIKEY"), "model", "jev-1.14.0"));
    // This PNG is 384 by 384, above Jev's minimum image area.
    String image = Base64.getEncoder().encodeToString(Files.readAllBytes(Path.of("src/examples/assets/decision-shapes.png")));
    var locate = Ax.ax("photo:image -> visible:boolean \"Is there a red square in photo?\", target:box(evidence) \"The red square in photo\"");
    var result = locate.forward(model, Map.of("photo", Map.of("mimeType", "image/png", "data", image)));
    // A region is always returned; consume it only when the target is present.
    if (Boolean.TRUE.equals(result.get("visible"))) System.out.println(Json.stringify(result.get("target")));
    else System.out.println("The target was not detected.");
  }
}
