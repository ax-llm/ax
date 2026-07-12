// ax-example:start
// title: Java Native MCP Tools
// group: mcp
// description: Attaches a live MCP client directly to AxGen without a lossy function adapter.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY, MCP_URL
// level: beginner
// order: 10
// story: 60
// ax-example:end
import dev.axllm.ax.*;
import java.util.*;

public final class NativeMCPToolsExample {
  public static void main(String[] args) {
    String key = Optional.ofNullable(System.getenv("OPENAI_API_KEY")).orElse(System.getenv("OPENAI_APIKEY"));
    String endpoint = System.getenv("MCP_URL");
    if (key == null || endpoint == null) throw new IllegalStateException("Set OPENAI_API_KEY and MCP_URL.");
    AxMCPClient mcp = new AxMCPClient(new AxMCPStreamableHTTPTransport(endpoint), Map.of("namespace", "inventory"));
    AxGen program = new AxGen(Ax.s("request:string -> answer:string"), Map.of("mcp", mcp));
    OpenAICompatibleClient llm = new OpenAICompatibleClient(Map.of("api_key", key, "model", "gpt-5.4-mini"));
    System.out.println(Json.stringify(program.forward(llm, Map.of("request", "Reindex inventory."))));
  }
}
