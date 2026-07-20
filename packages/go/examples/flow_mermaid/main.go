package main

import (
	"fmt"
	"strings"

	ax "github.com/ax-llm/ax/packages/go"
)

func main() {
	source := `flowchart TD
  %%ax classify: requestText:string -> route:class "support, sales"
  %%ax reply: requestText:string -> replyText:string(max 300)
  classify{route} -->|support| reply`
	program := ax.NewFlow(source)
	rendered := program.String()
	if !strings.Contains(rendered, "%%ax reply: requestText:string -> replyText:string(max 300)") {
		panic(rendered)
	}
	if !strings.Contains(rendered, "classify -->|support| reply") {
		panic(rendered)
	}
	if ax.NewFlow(rendered).String() != rendered {
		panic("round-trip changed")
	}
	fmt.Println("go-flow-mermaid-ok")
}
