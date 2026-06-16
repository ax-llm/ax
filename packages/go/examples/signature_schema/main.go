package main

import (
	"fmt"

	ax "github.com/ax-llm/ax/go"
)

func main() {
	sig := ax.NewSignature("question:string -> answer:string")
	schema := sig.ToJSONSchema(nil).(map[string]ax.Value)
	fmt.Println("go-signature-schema-ok", "schema", schema["type"], "outputs", len(sig.GetOutputFields()))
}
