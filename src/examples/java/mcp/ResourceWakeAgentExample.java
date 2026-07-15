// ax-example:start
// title: Java MCP Resource Wake
// group: mcp
// description: Subscribes over real Streamable HTTP and lets AxEventRuntime wake an authenticated Agent automatically.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY, AX_MCP_ENDPOINT
// level: intermediate
// order: 20
// story: 61
// ax-example:end
import dev.axllm.ax.*;
import dev.axllm.ax.runtime.quickjs.*;
import java.util.*;
import java.util.concurrent.*;

public final class ResourceWakeAgentExample {
  public static void main(String[] args) throws Exception {
    String key=Optional.ofNullable(System.getenv("OPENAI_API_KEY")).orElse(System.getenv("OPENAI_APIKEY"));String endpoint=System.getenv("AX_MCP_ENDPOINT");if(key==null||endpoint==null)throw new IllegalStateException("Set OPENAI_API_KEY and AX_MCP_ENDPOINT.");boolean local=endpoint.startsWith("http://127.0.0.1");
    AxMCPStreamableHTTPTransport transport=new AxMCPStreamableHTTPTransport(endpoint,Map.of("ssrfProtection",Map.of("requireHttps",!local,"allowLocalhost",local,"allowPrivateNetworks",local)));AxMCPClient client=new AxMCPClient(transport,Map.of("namespace","inventory"));AxMCPEventSource source=new AxMCPEventSource(client,"inventory","tenant:demo","authenticated",AxMCPEventSource.all());AxAgent agent=Ax.agent("uri:string -> summary:string",Map.of("runtime",Map.of("language","JavaScript")));OpenAICompatibleClient llm=new OpenAICompatibleClient(Map.of("api_key",key,"model","gpt-5.4-mini"));CountDownLatch completed=new CountDownLatch(1);
    AxEventRuntime runtime=new AxEventRuntime(List.of(new AxEventRoute("resource-wake","wake",Map.of("types",List.of("mcp.resource.updated")),"inventory-agent",true,"strict",0))).registerTarget(new AxEventRuntime.Target("inventory-agent",(input,context)->{try(AxQuickJsCodeRuntime js=new AxQuickJsCodeRuntime()){Object output=agent.forward(llm,castMap(input),Map.of("runtime",js));System.out.println(Json.stringify(output));completed.countDown();return output;}}).mapInput((event,continuation)->Map.of("uri",castMap(event.data()).get("uri"))).retrySafety("idempotent")).addSource(source);runtime.start();if(!completed.await(60,TimeUnit.SECONDS))throw new IllegalStateException("Timed out waiting for an MCP resource notification");runtime.close();client.close();
  }
  @SuppressWarnings("unchecked")private static Map<String,Object> castMap(Object value){return(Map<String,Object>)value;}
}
