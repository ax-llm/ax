// ax-example:start
// title: Go Data Analyst (Large Context + Tools)
// group: long-agents
// description: Combines a large data dictionary held in contextFields with typed warehouse tools, so the agent answers business questions over a big dataset it never has to inline.
// provider: google-gemini
// env: GOOGLE_APIKEY
// level: advanced
// order: 30
// ax-example:end
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"strings"
	"time"

	ax "github.com/ax-llm/ax/go"
	axgoja "github.com/ax-llm/ax/go/runtime/goja"
)

func geminiClient() *ax.GoogleGeminiClient {
	apiKey := os.Getenv("GOOGLE_APIKEY")
	if apiKey == "" {
		panic("Set GOOGLE_APIKEY to run this example.")
	}
	model := os.Getenv("AX_GEMINI_MODEL")
	if model == "" {
		model = "gemini-3-flash-preview"
	}
	return ax.NewGoogleGeminiClient(map[string]ax.Value{"api_key": apiKey, "model": model})
}

func printJSON(value ax.Value) {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		panic(err)
	}
	fmt.Println(string(data))
}

func roundTo(v float64, places int) float64 {
	scale := math.Pow(10, float64(places))
	return math.Round(v*scale) / scale
}

// ---------------------------------------------------------------------------
// The "warehouse": a few hundred rows that live in the host process and are
// reachable only through tools. The model never sees the rows -- it queries
// them. Deterministic so the example is reproducible.
// ---------------------------------------------------------------------------
var months = []string{"Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"}

type row struct {
	region     string
	product    string
	monthIndex int
	month      string
	units      int
	revenue    int
	returnRate float64
}

func buildWarehouse() []row {
	regions := []string{"North", "South", "East", "West", "Central", "NW", "NE", "SE"}
	products := []string{"Widget-A", "Widget-B", "Gadget-X", "Gadget-Y"}
	rows := []row{}
	seed := int64(7)
	rand := func() float64 {
		seed = (seed*1103515245 + 12345) & 0x7FFFFFFF
		return float64(seed) / float64(0x7FFFFFFF)
	}

	for _, region := range regions {
		for _, product := range products {
			trend := 25 // a planted winner
			if product == "Gadget-X" && region == "East" {
				trend = 90
			}
			for m := 0; m < len(months); m++ {
				units := int(math.Round(400 + rand()*1200 + float64(m*trend)))
				price := 38
				if strings.HasPrefix(product, "Gadget") {
					price = 60
				}
				extra := 0.0
				if product == "Widget-B" {
					extra = 0.03
				}
				returnRate := roundTo(0.01+rand()*0.05+extra, 3)
				rows = append(rows, row{
					region: region, product: product, monthIndex: m, month: months[m],
					units: units, revenue: units * price, returnRate: returnRate,
				})
			}
		}
	}
	return rows
}

var warehouse = buildWarehouse()

// The schema/data dictionary is large-ish and goes into contextFields so the
// agent orients on column meaning + business rules without the doc entering the prompt.
var schema = strings.TrimSpace(`
TABLE sales (one row per region x product x month)

COLUMNS
  region       text   one of: North, South, East, West, Central, NW, NE, SE
  product      text   one of: Widget-A, Widget-B, Gadget-X, Gadget-Y
  month        text   Jan..Dec (calendar order; monthIndex 0..11)
  units        int    units sold that month
  revenue      int    integer dollars (units * unit price; Gadgets cost more)
  returnRate   float  fraction of units returned, 0..1

BUSINESS RULES
  - "Growth" = change in monthly revenue from Jan to Dec for a region+product.
  - A return rate above 0.05 (5%) is flagged for quality review.
  - Compare like-for-like: always group by region AND product, not either alone.

TOOLS AVAILABLE (call them, never invent figures)
  query  filter + aggregate a slice -> {matched, totalUnits, totalRevenue, avgReturnRate}
  top    rank a metric ("revenue"|"units") grouped by "product"|"region" -> [{key, value}]
  trend  monthly revenue series (Jan..Dec) for one region + product
`)

func asMap(value ax.Value) map[string]ax.Value {
	if out, ok := value.(map[string]ax.Value); ok {
		return out
	}
	return map[string]ax.Value{}
}

func asString(value ax.Value) string {
	if value == nil {
		return ""
	}
	if s, ok := value.(string); ok {
		return s
	}
	return fmt.Sprint(value)
}

// --- Host tool handlers over the warehouse (the model never sees the rows) ---
func queryTool(params ax.Value) (ax.Value, error) {
	p := asMap(params)
	region, product, month := asString(p["region"]), asString(p["product"]), asString(p["month"])
	matched := 0
	totalUnits := 0
	totalRevenue := 0
	sumReturn := 0.0
	for _, r := range warehouse {
		if (region != "" && r.region != region) || (product != "" && r.product != product) || (month != "" && r.month != month) {
			continue
		}
		matched++
		totalUnits += r.units
		totalRevenue += r.revenue
		sumReturn += r.returnRate
	}
	avgReturn := 0.0
	if matched > 0 {
		avgReturn = roundTo(sumReturn/float64(matched), 4)
	}
	return ax.Object("matched", matched, "totalUnits", totalUnits, "totalRevenue", totalRevenue, "avgReturnRate", avgReturn), nil
}

func topTool(params ax.Value) (ax.Value, error) {
	p := asMap(params)
	metric := asString(p["metric"])
	if metric == "" {
		metric = "revenue"
	}
	groupBy := asString(p["groupBy"])
	if groupBy == "" {
		groupBy = "product"
	}
	limit := 5
	if raw, ok := p["limit"]; ok {
		switch v := raw.(type) {
		case int:
			limit = v
		case int64:
			limit = int(v)
		case float64:
			limit = int(v)
		}
	}
	totals := map[string]int{}
	order := []string{}
	for _, r := range warehouse {
		key := r.product
		if groupBy == "region" {
			key = r.region
		}
		if _, seen := totals[key]; !seen {
			order = append(order, key)
		}
		if metric == "units" {
			totals[key] += r.units
		} else {
			totals[key] += r.revenue
		}
	}
	// Stable rank by value descending.
	for i := 0; i < len(order); i++ {
		for j := i + 1; j < len(order); j++ {
			if totals[order[j]] > totals[order[i]] {
				order[i], order[j] = order[j], order[i]
			}
		}
	}
	ranked := []ax.Value{}
	for i, key := range order {
		if i >= limit {
			break
		}
		ranked = append(ranked, ax.Object("key", key, "value", totals[key]))
	}
	return ax.Array(ranked...), nil
}

func trendTool(params ax.Value) (ax.Value, error) {
	p := asMap(params)
	region, product := asString(p["region"]), asString(p["product"])
	series := make([]ax.Value, 12)
	for i := range series {
		series[i] = 0
	}
	for _, r := range warehouse {
		if r.region == region && r.product == product {
			series[r.monthIndex] = r.revenue
		}
	}
	return ax.Array(series...), nil
}

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	client := geminiClient()

	fmt.Printf("Warehouse: %d rows (kept out of the prompt; reachable only via tools).\n", len(warehouse))

	runtime := axgoja.NewRuntime(
		axgoja.WithCallable("query", queryTool),
		axgoja.WithCallable("top", topTool),
		axgoja.WithCallable("trend", trendTool),
	)

	analyst := ax.NewAgent(
		`schema:string, question:string -> answer:string, evidence:string[] "Concrete figures the answer is based on"`,
		map[string]ax.Value{
			// Big data dictionary stays out of the prompt.
			"contextFields": ax.Array("schema"),
			// Tool specs advertised to the model; handlers are registered on the runtime above.
			"functions": ax.Array(
				ax.Object(
					"name", "query",
					"description", "Filter the sales table and return aggregates for the matching rows.",
					"parameters", ax.Object(
						"type", "object",
						"properties", ax.Object(
							"region", ax.Object("type", "string"),
							"product", ax.Object("type", "string"),
							"month", ax.Object("type", "string"),
						),
					),
				),
				ax.Object(
					"name", "top",
					"description", "Rank a metric (revenue|units) grouped by product|region, highest first.",
					"parameters", ax.Object(
						"type", "object",
						"properties", ax.Object(
							"metric", ax.Object("type", "string"),
							"groupBy", ax.Object("type", "string"),
							"limit", ax.Object("type", "number"),
						),
						"required", ax.Array("metric", "groupBy"),
					),
				),
				ax.Object(
					"name", "trend",
					"description", "Monthly revenue series (Jan..Dec) for one region and product.",
					"parameters", ax.Object(
						"type", "object",
						"properties", ax.Object(
							"region", ax.Object("type", "string"),
							"product", ax.Object("type", "string"),
						),
						"required", ax.Array("region", "product"),
					),
				),
			),
			"contextPolicy": ax.Object("preset", "lean", "budget", "balanced"),
			"executorOptions": ax.Object("description", strings.Join([]string{
				"Consult the schema for column meaning and business rules.",
				"Answer using the warehouse tools -- never invent figures.",
				"Return rates: call query({product}) for each of Widget-A, Widget-B, Gadget-X, Gadget-Y and read avgReturnRate; any product with avgReturnRate > 0.05 is above the review threshold.",
				"Growth: call trend({region, product}); the returned array is revenue Jan..Dec, so growth = last element minus first element. Compare a few region+product pairs and report the largest.",
				"Cite the concrete numbers you observed as evidence, then call final(...).",
			}, "\n")),
			"runtime": ax.Object("language", "JavaScript"),
		},
	)

	result, err := analyst.Forward(
		ctx,
		client,
		map[string]ax.Value{
			"schema":   schema,
			"question": "Which region+product had the strongest Jan->Dec revenue growth, and which products have an average return rate above the 5% review threshold?",
		},
		map[string]ax.Value{"runtime": runtime, "max_actor_steps": 40},
	)
	if err != nil {
		panic(err)
	}

	printJSON(result)
}
