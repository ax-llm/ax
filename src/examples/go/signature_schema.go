package main

import (
	"fmt"

	ax "github.com/ax-llm/ax/go"
)

func main() {
	sig := ax.NewSignature("question:string -> answer:string")
	schema := sig.ToJSONSchema(nil).(map[string]ax.Value)
	fmt.Println("go-signature-schema", "outputs", len(sig.GetOutputFields()), "schema", schema["type"])
}
