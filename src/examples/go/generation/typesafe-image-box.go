// ax-example:start
// title: Go Jev Image Localization
// group: generation
// description: Locates a red square using image inputs and Box outputs with native confidence.
// provider: typesafe
// env: TYPESAFE_APIKEY
// level: intermediate
// order: 47
// ax-example:end
package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	ax "github.com/ax-llm/ax/packages/go"
	"os"
	"time"
)

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	model := ax.NewAI("typesafe", map[string]ax.Value{"api_key": os.Getenv("TYPESAFE_APIKEY"), "model": "jev-1.14.0"})
	data, err := os.ReadFile("src/examples/assets/decision-shapes.png")
	if err != nil {
		panic(err)
	}
	locate := ax.NewAx("photo:image -> visible:boolean \"Is there a red square in photo?\", target:box(evidence) \"The red square in photo\"", nil)
	result, err := locate.Forward(ctx, model, map[string]ax.Value{"photo": map[string]ax.Value{"mimeType": "image/png", "data": base64.StdEncoding.EncodeToString(data)}}, nil)
	if err != nil {
		panic(err)
	}
	values := result.(map[string]ax.Value)
	// Jev always returns a region; consume it only when the target is present.
	if values["visible"] == true {
		output, err := json.MarshalIndent(values["target"], "", "  ")
		if err != nil {
			panic(err)
		}
		fmt.Println(string(output))
	} else {
		fmt.Println("The target was not detected.")
	}
}
