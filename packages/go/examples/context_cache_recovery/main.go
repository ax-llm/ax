package main

import (
  "context"
  "fmt"
  "time"
  ax "github.com/ax-llm/ax/packages/go"
)

func success(text string) ax.Value { return ax.Object("status", 200.0, "json", ax.Object("candidates", ax.Array(ax.Object("content", ax.Object("parts", ax.Array(ax.Object("text", text)))), "finishReason", "STOP"))) }
func cache(name string, seconds int64) ax.Value { return ax.Object("status", 200.0, "json", ax.Object("name", name, "expireTime", float64(time.Now().Add(time.Duration(seconds)*time.Second).UnixMilli()))) }
func failure(status float64, message string) ax.Value { return ax.Object("status", status, "json", ax.Object("error", ax.Object("message", message))) }
func service(transport *ax.ScriptedTransport) *ax.GoogleGeminiClient { return ax.NewGoogleGeminiClient(map[string]ax.Value{"model":"gemini-3.5-flash", "api_key":"gemini-key", "transport":transport, "contextCache":ax.Object("minTokens",0.0,"ttlSeconds",3600.0,"refreshWindowSeconds",300.0)}) }
func methods(requests []ax.Value) []string { out:=[]string{}; for _,request:=range requests { out=append(out, request.(map[string]ax.Value)["method"].(string)) }; return out }
func same(actual []string, expected ...string) bool { if len(actual)!=len(expected){return false}; for i:=range actual{if actual[i]!=expected[i]{return false}}; return true }

func main() {
  request:=map[string]ax.Value{"chat_prompt":ax.Array(ax.Object("role","system","content","stable context"),ax.Object("role","user","content","answer briefly"))}
  recovery:=ax.NewScriptedTransport([]ax.Value{cache("cachedContents/cache-1",3600),failure(400,"cachedContent is invalid"),success("uncached recovery")})
  out,err:=service(recovery).Chat(context.Background(),request,nil); if err!=nil||out==nil||!same(methods(recovery.Requests),"POST","POST","POST"){panic(fmt.Sprint(out,err,recovery.Requests))}
  refresh:=ax.NewScriptedTransport([]ax.Value{cache("cachedContents/old",1),success("old"),failure(500,"refresh failed"),cache("cachedContents/new",3600),success("recreated")})
  refreshClient:=service(refresh); if _,err=refreshClient.Chat(context.Background(),request,nil);err!=nil{panic(err)}; if _,err=refreshClient.Chat(context.Background(),request,nil);err!=nil||!same(methods(refresh.Requests),"POST","POST","PATCH","POST","POST"){panic(fmt.Sprint(err,refresh.Requests))}
  fallback:=ax.NewScriptedTransport([]ax.Value{cache("cachedContents/old",1),success("old"),failure(500,"refresh failed"),failure(500,"recreate failed"),success("uncached fallback")})
  fallbackClient:=service(fallback); if _,err=fallbackClient.Chat(context.Background(),request,nil);err!=nil{panic(err)}; if _,err=fallbackClient.Chat(context.Background(),request,nil);err!=nil||!same(methods(fallback.Requests),"POST","POST","PATCH","POST","POST"){panic(fmt.Sprint(err,fallback.Requests))}
  fmt.Println("go-context-cache-recovery-ok")
}
