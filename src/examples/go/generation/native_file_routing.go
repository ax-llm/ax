// ax-example:start
// title: Go Native File Routing
// group: generation
// description: Summarizes a PDF through a provider router without replacing the native file with extracted text.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY, AX_PDF_BASE64
// level: intermediate
// order: 53
// ax-example:end
package main

import (
 "context"
 "fmt"
 "os"
 ax "github.com/ax-llm/ax/packages/go"
)
func main() {
 key:=os.Getenv("OPENAI_API_KEY");if key==""{key=os.Getenv("OPENAI_APIKEY")}
 client := ax.NewAI("openai", ax.Object("api_key",key,"model","gpt-6-astra","model_config",ax.Object("thinkingTokenBudget","low")))
 router := ax.NewProviderRouter(ax.Object("providers",ax.Object("primary",client)))
 program := ax.NewAx("document:file -> summary:string",nil)
 result,err := program.Forward(context.Background(),router,ax.Object("document",ax.Object("filename","report.pdf","mimeType","application/pdf","data",os.Getenv("AX_PDF_BASE64"))),ax.Object("serviceTier","standard"))
 if err != nil {panic(err)}
 fmt.Println(result)
}
