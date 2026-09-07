// ax-example:start
// title: Java Concurrent Astra Flow
// group: flows
// description: Independent conversations overlap, retain their tool results, and receive scoped controls.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 13
// ax-example:end
import dev.axllm.ax.*;
import java.util.*;
import java.util.concurrent.*;

public class AstraParallelFlowExample {
  public static void main(String[] args) throws Exception {
    String key=System.getenv("OPENAI_API_KEY");if(key==null||key.isBlank())key=System.getenv("OPENAI_APIKEY");if(key==null||key.isBlank())throw new IllegalStateException("Set OPENAI_API_KEY or OPENAI_APIKEY.");
    var client=Ax.ai("openai",Map.of("api_key",key,"model","gpt-6-astra","model_config",Map.of("thinkingTokenBudget","low","max_tokens",4096)));
    var control=Ax.runControl();var both=new CyclicBarrier(2);var updatesReady=new CountDownLatch(1);var paths=new HashSet<String>();var applied=new ArrayList<Map<String,Object>>();
    control.onEvent(event->{
      if("tool.started".equals(event.get("type"))){paths.add(String.valueOf(event.get("path")));if(paths.size()==2){control.steer("Include VERIFIED with the exact reference in your final answer.");control.setThinkingTokenBudget("medium","root/left");updatesReady.countDown();}}
      if("applied".equals(event.get("type")))applied.add(event);
    });
    var lookup=Ax.fn("lookup").description("Look up the exact reference once.").execution("background").handler(values->{
      both.await(45,TimeUnit.SECONDS);if(!updatesReady.await(5,TimeUnit.SECONDS))throw new IllegalStateException("Controller did not observe both nodes");return "REF-42";
    }).build();
    var program=Ax.ax("question -> answer").addTool(lookup);
    var workflow=Ax.flow().execute("left",program).execute("right",program).returns(Map.of("left","leftResult","right","rightResult"));
    var result=workflow.forward(client,Map.of("question","Call lookup exactly once. If its result is pending, return a brief progress message without calling it again. Return the exact reference when its result arrives."),Map.of("control",control,"serviceTier","standard","maxSteps",6));
    if(!paths.equals(Set.of("root/left","root/right"))||applied.size()!=3)throw new AssertionError("Missing scoped controls: "+applied);
    for(String node:List.of("left","right")){String answer=String.valueOf(result.get(node));if(!answer.contains("REF-42")||!answer.contains("VERIFIED"))throw new AssertionError("Missing final result: "+answer);}
    System.out.println(Json.stringify(Map.of("result",result,"parallel_overlap",true,"applied_controls",applied)));
  }
}
