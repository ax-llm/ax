// ax-example:start
// title: Java Child Agent Controls
// group: short-agents
// description: Delegates through a real actor runtime and applies controls to the child scope.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 13
// ax-example:end
import dev.axllm.ax.*;
import dev.axllm.ax.runtime.quickjs.AxQuickJsCodeRuntime;
import java.util.*;

public final class AstraChildAgentExample {
 public static void main(String[] args) throws Exception {
  String key=System.getenv("OPENAI_API_KEY");if(key==null||key.isBlank())key=System.getenv("OPENAI_APIKEY");if(key==null||key.isBlank())throw new IllegalStateException("Set OPENAI_API_KEY or OPENAI_APIKEY.");
  var client=Ax.ai("openai",Map.of("api_key",key,"model","gpt-6-astra","model_config",Map.of("thinkingTokenBudget","low","max_tokens",4096)));
  var control=Ax.runControl();var events=new ArrayList<Map<String,Object>>();control.onEvent(events::add);
  control.steer("Include VERIFIED in the final answer.");control.steer("Include CHILD-CHECK in the final answer.","root/team.researcher");control.setThinkingTokenBudget("medium","root/team.researcher/executor");
  try(var parentRuntime=new AxQuickJsCodeRuntime(Map.of("timeoutMs",180000));var childRuntime=new AxQuickJsCodeRuntime(Map.of("timeoutMs",180000))){
   var child=Ax.agent("question -> answer",Map.of("directResponse","off","runtime",childRuntime));
   var parent=Ax.agent("question -> answer",Map.of("directResponse","off","runtime",parentRuntime)).addChildAgent("team","researcher",child);
   var result=parent.forward(client,Map.of("question","Delegate to team.researcher exactly once by calling await team.researcher({question: \"Compute 37 + 5 and return the exact sum.\"}) in actor code. Pass the complete child answer as evidence to final(...), then report it in your final answer."),Map.of("control",control,"serviceTier","standard","max_actor_steps",8));
   for(String word:List.of("42","VERIFIED","CHILD-CHECK"))if(!result.toString().contains(word))throw new AssertionError(result);
   if(events.stream().noneMatch(event->"applied".equals(event.get("type"))&&"root/team.researcher/executor".equals(event.get("path"))))throw new AssertionError("Child control did not apply");
   System.out.println(Json.stringify(Map.of("result",result,"usage",parent.getUsage())));
  }
 }
}
