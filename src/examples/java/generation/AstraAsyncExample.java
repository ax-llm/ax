// ax-example:start
// title: Java Automatic Background Tools
// group: generation
// description: Uses ordinary generation with background tools, steering, and a reasoning update.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 12
// ax-example:end
import dev.axllm.ax.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

public final class AstraAsyncExample {
  public static void main(String[] args) throws Exception {
    String key=System.getenv("OPENAI_API_KEY");if(key==null||key.isBlank())key=System.getenv("OPENAI_APIKEY");if(key==null||key.isBlank())throw new IllegalArgumentException("Set OPENAI_API_KEY or OPENAI_APIKEY.");
    AiClient client=Ax.ai("openai",Map.of("api_key",key,"model","gpt-6-astra","model_config",Map.of("thinkingTokenBudget","low","max_tokens",4096)));
    CountDownLatch pending=new CountDownLatch(1);AtomicBoolean finished=new AtomicBoolean(),overlap=new AtomicBoolean(),steered=new AtomicBoolean();AtomicInteger applied=new AtomicInteger();
    AxRunControl control=Ax.runControl();control.onEvent(event->{if("applied".equals(event.get("type")))applied.incrementAndGet();});
    Tool slow=Ax.fn("slow_reference").description("Look up a reference; takes a few seconds.").execution("background").handler(values->{pending.countDown();if(steered.compareAndSet(false,true)){control.steer("Include the word VERIFIED in the final answer.");control.setThinkingTokenBudget("medium");}Thread.sleep(6000);finished.set(true);return "REF-42";}).build();
    Tool label=Ax.fn("local_label").description("Read an independent local label immediately.").handler(values->{if(pending.await(3,TimeUnit.SECONDS)&&!finished.get())overlap.set(true);return "LAUNCH";}).build();
    var program=Ax.ax("question -> answer").addTool(slow).addTool(label);
    var result=program.forward(client,Map.of("question","First call slow_reference. While it is pending, call local_label. Call each tool only once; do not call a tool again while its result is pending. If a required tool result is still pending, end this response with a brief progress message. The application will continue with the result when it arrives; do not spend reasoning tokens waiting for it. Once both results arrive, return them in one sentence."),Map.of("control",control,"serviceTier","standard","maxSteps",6));
    String answer=result.toString();for(String word:List.of("REF-42","LAUNCH","VERIFIED"))if(!answer.contains(word))throw new AssertionError("Missing final result: "+answer);
    if(!overlap.get())throw new AssertionError("No independent work while background tool was pending");if(applied.get()!=2)throw new AssertionError("Control updates were not applied");
    System.out.println(answer);System.out.println("Background overlap verified; steering and reasoning applied at the next response.");
  }
}
