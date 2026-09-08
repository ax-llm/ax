// ax-example:start
// title: Go Concurrent Astra Flow
// group: flows
// description: Independent conversations overlap, retain their tool results, and receive scoped controls.
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
    key:=os.Getenv("OPENAI_API_KEY");if key==""{key=os.Getenv("OPENAI_APIKEY")};if key==""{panic("Set OPENAI_API_KEY or OPENAI_APIKEY.")}
    client:=ax.NewAI("openai",ax.Object("api_key",key,"model","gpt-6-astra","model_config",ax.Object("thinkingTokenBudget","low","max_tokens",4096)))
    control:=ax.RunControl();both,updatesReady:=make(chan struct{}),make(chan struct{});var calls atomic.Int32
    paths:=map[string]bool{};var applied []map[string]ax.Value
    control.OnEvent(func(event map[string]ax.Value){
        if event["type"]=="tool.started"{paths[fmt.Sprint(event["path"])]=true;if len(paths)==2{
            if err:=control.Steer("Include VERIFIED with the exact reference in your final answer.");err!=nil{panic(err)}
            if err:=control.SetThinkingTokenBudget("medium","root/left");err!=nil{panic(err)}
            close(updatesReady)
        }}
        if event["type"]=="applied"{applied=append(applied,event)}
    })
    lookup:=ax.Fn("lookup").Execution("background").WithContextHandler(func(ctx context.Context,_ map[string]ax.Value)(ax.Value,error){
        count:=calls.Add(1);if count>2{return nil,fmt.Errorf("lookup was called more than once per node")};if count==2{close(both)}
        select{case <-both:case <-ctx.Done():return nil,ctx.Err()};select{case <-updatesReady:case <-ctx.Done():return nil,ctx.Err()};return "REF-42",nil
    })
    program:=ax.NewAx("question -> answer",nil);program.Functions=[]ax.Tool{lookup}
    workflow:=ax.NewFlow(nil).Execute("left",program,nil).Execute("right",program,nil).Returns(ax.Object("left","leftResult","right","rightResult"))
    ctx,cancel:=context.WithTimeout(context.Background(),90*time.Second);defer cancel()
    result,err:=workflow.Forward(ctx,client,ax.Object("question","Call lookup exactly once. If its result is pending, return a brief progress message without calling it again. Return the exact reference when its result arrives."),ax.Object("control",control,"serviceTier","standard","maxSteps",6));if err!=nil{panic(err)}
    if !paths["root/left"]||!paths["root/right"]||len(applied)!=3{panic(fmt.Sprint("Missing scoped controls: ",paths,applied))}
    for _,node:=range []string{"left","right"}{answer:=fmt.Sprint(result.(map[string]ax.Value)[node]);if !strings.Contains(answer,"REF-42")||!strings.Contains(answer,"VERIFIED"){panic("Missing final result: "+answer)}}
    fmt.Println(result);fmt.Println("Parallel overlap verified; root steering and targeted reasoning applied.")
}
