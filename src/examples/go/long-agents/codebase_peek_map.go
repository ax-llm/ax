// ax-example:start
// title: Go Codebase Q&A with a Peek Context Map
// group: long-agents
// description: Answers several dependency questions over one large module index by building and reusing an evolving context map (the "peek" orientation cache), so later questions skip re-scanning the corpus.
// provider: google-gemini
// env: GOOGLE_APIKEY
// level: advanced
// order: 20
// ax-example:end
package main

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	ax "github.com/ax-llm/ax/packages/go"
	axgoja "github.com/ax-llm/ax/packages/go/runtime/goja"
)

func geminiClient() *ax.GoogleGeminiClient {
	apiKey := os.Getenv("GOOGLE_APIKEY")
	if apiKey == "" {
		panic("Set GOOGLE_APIKEY to run this example.")
	}
	model := os.Getenv("AX_GEMINI_MODEL")
	if model == "" {
		model = "gemini-3.5-flash"
	}
	return ax.NewGoogleGeminiClient(map[string]ax.Value{"api_key": apiKey, "model": model})
}

type module struct {
	path    string
	imports []string
	writes  string
}

// ---------------------------------------------------------------------------
// A large module-dependency index for a monorepo. Each block is a record the
// agent must *search* to answer -- the answers cannot be guessed, only computed
// by filtering the index. Generated large so it would not fit comfortably in a
// prompt; it lives in contextFields and is queried from the runtime.
// ---------------------------------------------------------------------------
func buildModuleIndex() []module {
	core := []module{
		{"packages/api/middleware/auth.ts", []string{"packages/shared"}, "-"},
		{"packages/api/middleware/rateLimit.ts", []string{"packages/db"}, "-"},
		{"packages/api/routes/checkout.ts", []string{"packages/api/middleware/auth.ts", "packages/services/orders/createOrder.ts", "packages/services/payments/charge.ts"}, "-"},
		{"packages/api/routes/search.ts", []string{"packages/api/middleware/auth.ts", "packages/services/catalog/searchCatalog.ts"}, "-"},
		{"packages/services/orders/createOrder.ts", []string{"packages/db", "packages/clients/bus"}, "orders"},
		{"packages/services/orders/orderRepo.ts", []string{"packages/db"}, "orders"},
		{"packages/services/payments/charge.ts", []string{"packages/clients/acquirer", "packages/db"}, "payments"},
		{"packages/services/payments/refund.ts", []string{"packages/clients/acquirer", "packages/db"}, "refunds"},
		{"packages/services/catalog/searchCatalog.ts", []string{"packages/db"}, "-"},
		{"packages/clients/acquirer/index.ts", []string{"packages/shared"}, "-"},
		{"packages/clients/bus/index.ts", []string{"packages/shared"}, "-"},
	}
	// Filler modules so the index is genuinely large; some also depend on the acquirer.
	filler := []module{}
	for i := 0; i < 110; i++ {
		dep := "packages/db"
		if i%4 == 0 {
			dep = "packages/clients/acquirer"
		}
		writes := "-"
		if i%6 == 0 {
			writes = "audit"
		}
		filler = append(filler, module{
			path:    fmt.Sprintf("packages/services/feature%d/handler.ts", i),
			imports: []string{dep, "packages/shared"},
			writes:  writes,
		})
	}
	return append(core, filler...)
}

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	client := geminiClient()

	modules := buildModuleIndex()
	records := make([]string, 0, len(modules))
	for _, m := range modules {
		records = append(records, fmt.Sprintf("PATH: %s\nIMPORTS: %s\nWRITES: %s", m.path, strings.Join(m.imports, ", "), m.writes))
	}
	codebaseIndex := strings.Join(records, "\n\n")
	fmt.Printf("Module index: %d records (kept out of the prompt).\n", len(modules))

	analyst := ax.NewAgent(
		`context:string, question:string -> answer:string, paths:string[] "Exact PATH values from the index that answer the question"`,
		map[string]ax.Value{
			"contextFields": ax.Array("context"),
			"contextPolicy": ax.Object("preset", "adaptive", "budget", "balanced"),
			"contextOptions": ax.Object(
				"description", `The context is a module index of "PATH / IMPORTS / WRITES" records. Answer by filtering those records in code -- never guess. Return exact PATH values verbatim.`,
			),
			// The Peek context map: small, persistent orientation reused across queries.
			"contextMap": ax.Object("maxChars", 1800, "infiniteEvolve", false, "evolveSteps", 1),
			"runtime":    ax.Object("language", "JavaScript"),
		},
	)

	questions := []string{
		"Which modules import 'packages/clients/acquirer'? Give the exact PATH values.",
		"Which modules write to the 'orders' table?",
		"What are the direct IMPORTS of packages/api/routes/checkout.ts?",
	}

	runtime := axgoja.NewRuntime()
	for _, question := range questions {
		output, err := analyst.Forward(
			ctx,
			client,
			map[string]ax.Value{"context": codebaseIndex, "question": question},
			map[string]ax.Value{"runtime": runtime, "max_actor_steps": 24},
		)
		if err != nil {
			panic(err)
		}
		result, _ := output.(map[string]ax.Value)
		answer, _ := result["answer"].(string)
		paths := []string{}
		if raw, ok := result["paths"].([]ax.Value); ok {
			for _, p := range raw {
				paths = append(paths, fmt.Sprint(p))
			}
		}
		fmt.Println("\nQ:", question)
		fmt.Println("A:", answer)
		fmt.Println("Paths:", strings.Join(paths, ", "))
	}

	fmt.Println("\nThe context map evolved on the first query and was reused for the rest.")
}
