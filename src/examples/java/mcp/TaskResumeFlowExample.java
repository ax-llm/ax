// ax-example:start
// title: Java MCP Task Continuation
// group: mcp
// description: Creates an owned continuation and resumes an AxFlow from real MCP progress and terminal task notifications.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY, AX_MCP_ENDPOINT
// level: advanced
// order: 30
// story: 62
// ax-example:end
import dev.axllm.ax.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

public final class TaskResumeFlowExample {
  public static void main(String[] args)throws Exception{
    String key=Optional.ofNullable(System.getenv("OPENAI_API_KEY")).orElse(System.getenv("OPENAI_APIKEY"));String endpoint=System.getenv("AX_MCP_ENDPOINT");if(key==null||endpoint==null)throw new IllegalStateException("Set OPENAI_API_KEY and AX_MCP_ENDPOINT.");boolean local=endpoint.startsWith("http://127.0.0.1");AxMCPStreamableHTTPTransport transport=new AxMCPStreamableHTTPTransport(endpoint,Map.of("ssrfProtection",Map.of("requireHttps",!local,"allowLocalhost",local,"allowPrivateNetworks",local)));AxMCPClient client=new AxMCPClient(transport,Map.of("namespace","inventory"));client.addNotificationListener(message->{if("notifications/progress".equals(message.get("method")))System.out.println("MCP task progress");});client.init();String taskId=String.valueOf(castMap(client.callTool("start_reindex",Map.of("scope","all")).get("task")).get("taskId"));
    AxFlow flow=Ax.flow(Map.of("id","reindex-flow")).execute("status",Ax.ax("taskId:string -> status:string")).returns(Map.of("status","status"));OpenAICompatibleClient llm=new OpenAICompatibleClient(Map.of("api_key",key,"model","gpt-5.4-mini"));AtomicInteger calls=new AtomicInteger();CountDownLatch completed=new CountDownLatch(1);AxEventRuntime.Target target=new AxEventRuntime.Target("reindex-flow",(input,context)->{Object output=flow.forward(llm,castMap(input));System.out.println(Json.stringify(output));if(calls.incrementAndGet()>=2)completed.countDown();return output;}).mapInput((event,continuation)->Map.of("taskId",continuation==null?castMap(event.data()).get("taskId"):continuation.metadata.get("taskId"))).waitFor("mcp.task","taskKey",Map.of("taskId",taskId)).retrySafety("idempotent");
    AxEventRuntime runtime=new AxEventRuntime(List.of(new AxEventRoute("task-start","wake",Map.of("types",List.of("app.task.started")),"reindex-flow",false,"strict",0),new AxEventRoute("task-progress","observe",Map.of("types",List.of("mcp.progress")),null,false,"strict",0),new AxEventRoute("task-resume","resume",Map.of("types",List.of("mcp.task.status")),"reindex-flow",false,"strict",0))).registerTarget(target);runtime.start();runtime.publish(new AxEventEnvelope("task-start","app://tasks","app.task.started",Map.of("taskId",taskId,"taskKey","inventory:"+taskId)),"tenant:demo","authenticated");AxMCPEventSource source=new AxMCPEventSource(client,"inventory","tenant:demo","authenticated",List.of());source.start(event->runtime.publish(event,source.identityScope(),source.trust()));System.out.println("Waiting for terminal MCP task notification "+taskId);if(!completed.await(60,TimeUnit.SECONDS))throw new IllegalStateException("Timed out waiting for the MCP task continuation");source.close();runtime.close();client.close();
  }
  @SuppressWarnings("unchecked")private static Map<String,Object> castMap(Object value){return(Map<String,Object>)value;}
}
