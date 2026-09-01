// ax-example:start
// title: Go Model Catalog
// group: generation
// description: Lists static models and named OpenAI-compatible profiles with portable thinking levels and service tiers.
// provider: openai-compatible
// env: none
// level: beginner
// order: 16
// ax-example:end
package main

import (
	"fmt"

	ax "github.com/ax-llm/ax/packages/go"
)

func values(value ax.Value) []ax.Value {
	switch items := value.(type) {
	case []ax.Value:
		return items
	case *ax.AxArray:
		return items.Items
	default:
		panic(fmt.Sprintf("expected catalog array, got %T", value))
	}
}

func provider(catalog ax.Value, name string) map[string]ax.Value {
	for _, item := range values(catalog) {
		entry := item.(map[string]ax.Value)
		if entry["name"] == name {
			return entry
		}
	}
	panic("missing provider " + name)
}

func contains(items ax.Value, expected string) bool {
	for _, item := range values(items) {
		if item == expected {
			return true
		}
	}
	return false
}

func main() {
	catalog := ax.GetSupportedAIModels(map[string]ax.Value{})
	azure := provider(catalog, "azure-openai")
	openrouter := provider(catalog, "openrouter")
	azureCapabilities := azure["capabilities"].(map[string]ax.Value)
	openrouterCapabilities := openrouter["capabilities"].(map[string]ax.Value)

	if azure["isDynamic"] != true || len(values(azure["models"])) != 0 {
		panic("unexpected Azure profile")
	}
	if !contains(azureCapabilities["thinkingLevels"], "high") {
		panic("missing Azure thinking levels")
	}
	if !contains(azureCapabilities["serviceTiers"], "priority") {
		panic("missing Azure service tier")
	}
	if !contains(openrouterCapabilities["serviceTiers"], "flex") {
		panic("missing OpenRouter service tier")
	}

	fmt.Printf("%d providers; Azure and OpenRouter named profiles are available\n", len(values(catalog)))
}
