// ax-example:start
// title: Java Agent Background Tools
// group: short-agents
// description: Runs declared background agent tools with steering and verifies final result incorporation.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 12
// ax-example:end
import dev.axllm.ax.*;
import dev.axllm.ax.runtime.quickjs.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

public final class AstraAsyncAgentExample {
  public static void main(String[] args) throws Exception {
    String key=System.getenv("OPENAI_API_KEY");if(key==null||key.isBlank())key=System.getenv("OPENAI_APIKEY");if(key==null||key.isBlank())throw new IllegalArgumentException("Set OPENAI_API_KEY or OPENAI_APIKEY.");
    AiClient client=Ax.ai("openai",Map.of("api_key",key,"model","gpt-6-astra","model_config",Map.of("thinkingTokenBudget","low","max_tokens",4096)));
    CountDownLatch pending=new CountDownLatch(1);AtomicBoolean finished=new AtomicBoolean(),overlap=new AtomicBoolean(),steered=new AtomicBoolean();AtomicInteger applied=new AtomicInteger();
    AxRunControl control=Ax.runControl();control.onEvent(event->{if("applied".equals(event.get("type")))applied.incrementAndGet();});
    Tool slow=Ax.fn("slow_reference").description("Look up a reference; takes a few seconds.").execution("background").handler(values->{pending.countDown();if(steered.compareAndSet(false,true)){control.steer("Include the word VERIFIED in the final answer.");control.setThinkingTokenBudget("medium");}Thread.sleep(6000);finished.set(true);return "REF-42";}).build();
    Tool label=Ax.fn("local_label").description("Read an independent local label immediately.").execution("background").handler(values->{if(pending.await(3,TimeUnit.SECONDS)&&!finished.get())overlap.set(true);return "LAUNCH";}).build();
    var program=Ax.agent("question -> answer",Map.of("runtime",Map.of("language","JavaScript"),"directResponse","off","functions",List.of(slow,label)));
    try (AxQuickJsCodeRuntime runtime=new AxQuickJsCodeRuntime()) {
    var result=program.forward(client,Map.of("question","Use the native tools tools_slow_reference and tools_local_label. First call tools_slow_reference. While it is pending, call tools_local_label. Call each tool only once; do not call a tool again while its result is pending. In the executor, call the native tools directly rather than invoking them from actor code; then use final(...) in the code runtime to pass their results to the responder. Return both exact results in one sentence."),Map.of("runtime",runtime,"max_actor_steps",12,"control",control,"serviceTier","standard","maxSteps",6));
    String answer=result.toString();for(String word:List.of("REF-42","LAUNCH","VERIFIED"))if(!answer.contains(word))throw new AssertionError("Missing final result: "+answer);
    if(!overlap.get())throw new AssertionError("No independent work while background tool was pending");if(applied.get()<2)throw new AssertionError("Control updates were not applied");
    System.out.println(answer);System.out.println("Background overlap verified; steering and reasoning applied at the next response.");
    }
  }
}
