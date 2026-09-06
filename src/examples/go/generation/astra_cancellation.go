// ax-example:start
// title: Go Cancel Background Work
// group: generation
// description: Cancels a live Astra run through the high-level controller and observes cooperative tool cancellation.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 13
// ax-example:end
package main
import (
 "context"
 "fmt"
 "os"
 "strings"
 "sync/atomic"
 "time"
 ax "github.com/ax-llm/ax/packages/go"
)
func main() {
 key:=os.Getenv("OPENAI_API_KEY");if key=="" {key=os.Getenv("OPENAI_APIKEY")};if key=="" {panic("Set OPENAI_API_KEY or OPENAI_APIKEY.")}
 control:=ax.RunControl();settled:=make(chan struct{});var started atomic.Int64
 lookup:=ax.Fn("lookup").Execution("background").WithContextHandler(func(ctx context.Context,_ map[string]ax.Value)(ax.Value,error){started.Store(time.Now().UnixNano());control.Abort();select {case <-ctx.Done():close(settled);return "LATE: discard this result",nil;case <-time.After(2*time.Second):return nil,fmt.Errorf("Tool missed cancellation")}})
 program:=ax.NewAx("question -> answer",nil);program.Functions=[]ax.Tool{lookup}
 client:=ax.NewAI("openai",ax.Object("api_key",key,"model","gpt-6-astra","model_config",ax.Object("thinkingTokenBudget","low","max_tokens",2048)))
 ctx,cancel:=context.WithTimeout(context.Background(),90*time.Second);defer cancel()
 _,err:=program.Forward(ctx,client,ax.Object("question","Call lookup once and return its result."),ax.Object("control",control,"serviceTier","standard"))
 if err==nil||started.Load()==0||!strings.Contains(err.Error(),"unresolved calls") {panic(fmt.Sprintf("Expected cancelled pending work: %v",err))}
 elapsed:=time.Since(time.Unix(0,started.Load()));if elapsed>2*time.Second {panic("Cancellation blocked caller")};select {case <-settled:case <-time.After(2*time.Second):panic("Tool missed cancellation")}
 fmt.Printf("Cancelled in %s; %v\n",elapsed,err)
}
