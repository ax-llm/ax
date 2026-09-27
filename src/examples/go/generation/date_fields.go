// ax-example:start
// title: Go Date Fields
// group: generation
// description: Parses date, datetime and range outputs into ISO 8601 as TypeScript does with parseDates, and passes a time.Time as an input.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 47
// ax-example:end
package main

import (
	"context"
	"fmt"
	"os"
	"time"

	ax "github.com/ax-llm/ax/packages/go"
)

func main() {
	apiKey := os.Getenv("OPENAI_API_KEY")
	if apiKey == "" {
		apiKey = os.Getenv("OPENAI_APIKEY")
	}
	if apiKey == "" {
		panic("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.")
	}
	model := os.Getenv("AX_OPENAI_MODEL")
	if model == "" {
		model = "gpt-5.4-mini"
	}
	client := ax.NewAI("openai", map[string]ax.Value{"api_key": apiKey, "model": model})

	// parseDates reads the date-typed outputs as TypeScript does: an IANA
	// zone, an offset or an abbreviation at its literal offset, then
	// toISOString text. Without it (the default until the next major
	// version) they keep the model's text.
	planner := ax.NewAx(
		`emailText:string, sentAt:datetime -> meetingStartsAt:datetime "Start time with its time zone", meetingDay:date, travelWindow:dateRange "First and last day away"`,
		map[string]ax.Value{"parseDates": true},
	)
	out, err := planner.Forward(context.Background(), client, map[string]ax.Value{
		"emailText": "Can we meet next Tuesday at 3pm New York time? I'm travelling from the 8th to the 12th.",
		// A time.Time is rendered as TypeScript renders a Date.
		"sentAt": time.Date(2024, 5, 2, 16, 30, 0, 0, time.UTC),
	}, nil)
	if err != nil {
		panic(err)
	}
	fields := out.(map[string]ax.Value)
	fmt.Println(fields["meetingStartsAt"]) // e.g. 2024-05-07T19:00:00.000Z
	fmt.Println(fields["meetingDay"])      // e.g. 2024-05-07T00:00:00.000Z
	fmt.Println(fields["travelWindow"])    // map[end:... start:2024-05-08T00:00:00.000Z]
}
