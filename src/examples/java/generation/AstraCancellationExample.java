// ax-example:start
// title: Java Cancel Background Work
// group: generation
// description: Cancels a live Astra run through the high-level controller and observes cooperative tool cancellation.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 13
// ax-example:end
import dev.axllm.ax.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
public final class AstraCancellationExample {
 public static void main(String[] args)throws Exception {
  String key=System.getenv("OPENAI_API_KEY");if(key==null||key.isBlank())key=System.getenv("OPENAI_APIKEY");if(key==null||key.isBlank())throw new IllegalArgumentException("Set OPENAI_API_KEY or OPENAI_APIKEY.");
  var control=Ax.runControl();var settled=new CountDownLatch(1);var started=new AtomicLong();
  var lookup=Ax.fn("lookup").description("Look up the reference.").execution("background").contextHandler((values,cancelled)->{started.set(System.nanoTime());control.abort();long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(2);try {while(!cancelled.getAsBoolean()&&System.nanoTime()<deadline)Thread.sleep(1);}catch(InterruptedException interrupted){Thread.currentThread().interrupt();}if(!cancelled.getAsBoolean())throw new IllegalStateException("Tool missed cancellation");settled.countDown();return "LATE: discard this result";}).build();
  var program=Ax.ax("question -> answer").addTool(lookup);
  var client=Ax.ai("openai",Map.of("api_key",key,"model","gpt-6-astra","model_config",Map.of("thinkingTokenBudget","low","max_tokens",2048)));
  try {program.forward(client,Map.of("question","Call lookup once and return its result."),Map.of("control",control,"serviceTier","standard"));throw new AssertionError("Cancelled run returned success");}
  catch(CancellationException error){long elapsed=System.nanoTime()-started.get();if(started.get()==0||!error.getMessage().contains("unresolved calls")||elapsed>TimeUnit.SECONDS.toNanos(2)||!settled.await(2,TimeUnit.SECONDS))throw new AssertionError("Cancellation failed",error);System.out.println("Cancelled in "+TimeUnit.NANOSECONDS.toMillis(elapsed)+"ms; "+error.getMessage());}
 }
}
