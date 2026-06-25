// ax-example:start
// title: Go Speech To Text
// group: audio
// description: Transcribes a checked-in WAV file through OpenAI.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 20
// ax-example:end
package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"time"
	"io/ioutil"

	ax "github.com/ax-llm/ax/packages/go"
)


func openAIClient() *ax.OpenAICompatibleClient {
	apiKey := os.Getenv("OPENAI_API_KEY")
	if apiKey == "" { apiKey = os.Getenv("OPENAI_APIKEY") }
	if apiKey == "" { panic("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.") }
	model := os.Getenv("AX_OPENAI_MODEL")
	if model == "" { model = "gpt-5.4-mini" }
	return ax.NewOpenAICompatibleClient(map[string]ax.Value{"api_key": apiKey, "model": model, "model_config": ax.Object("temperature", 0)})
}

func printJSON(value ax.Value) {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil { panic(err) }
	fmt.Println(string(data))
}

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	client := openAIClient()
	wav, err := ioutil.ReadFile("src/examples/assets/presentation.wav")
	if err != nil { panic(err) }
	transcript, err := client.Transcribe(ctx, map[string]ax.Value{"audio": base64.StdEncoding.EncodeToString(wav), "language": "en", "model": "gpt-4o-mini-transcribe", "format": "json"}, nil)
	if err != nil { panic(err) }
	printJSON(transcript)
}
