// ax-example:start
// title: Go Self-Improving Lab Agent
// group: long-agents
// description: A many-tool agent that runs experiments, grades them against a rubric with an independent verifier, and distills verified rules into memory -- iterating until the rubric passes.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 40
// ax-example:end
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"regexp"
	"strings"
	"time"

	ax "github.com/ax-llm/ax/packages/go"
	axgoja "github.com/ax-llm/ax/packages/go/runtime/goja"
)

func openAIClient() *ax.OpenAICompatibleClient {
	apiKey := os.Getenv("OPENAI_API_KEY")
	if apiKey == "" {
		apiKey = os.Getenv("OPENAI_APIKEY")
	}
	if apiKey == "" {
		panic("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.")
	}
	model := os.Getenv("AX_OPENAI_MODEL")
	if model == "" {
		model = "gpt-4o-mini"
	}
	return ax.NewOpenAICompatibleClient(map[string]ax.Value{"api_key": apiKey, "model": model, "model_config": ax.Object("temperature", 0)})
}

func printJSON(value ax.Value) {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		panic(err)
	}
	fmt.Println(string(data))
}

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

// ---------------------------------------------------------------------------
// The "lab": a deterministic black-box experiment. It scores an ETL config plan
// against a hidden ideal and returns, for any failing check, the exact fix --
// so the agent can converge by following the feedback, not by being told.
// ---------------------------------------------------------------------------
var checks = []string{"no-nulls", "no-duplicates", "numeric-types", "trimmed-strings", "outliers-handled"}

var remedies = map[string]string{
	"no-nulls":         "set nullPolicy=impute (or nullPolicy=drop)",
	"no-duplicates":    "set dedup=on",
	"numeric-types":    "set coerceTypes=on",
	"trimmed-strings":  "set trim=on",
	"outliers-handled": "set outlier=clip (or outlier=winsorize)",
}

var flagRe = regexp.MustCompile(`([a-z]+)\s*=\s*([a-z0-9]+)`)

func runInSandbox(plan string) ax.Value {
	flags := map[string]string{}
	for _, m := range flagRe.FindAllStringSubmatch(strings.ToLower(plan), -1) {
		flags[m[1]] = m[2]
	}
	ok := map[string]bool{
		"no-nulls":         flags["nullpolicy"] == "impute" || flags["nullpolicy"] == "drop",
		"no-duplicates":    flags["dedup"] == "on",
		"numeric-types":    flags["coercetypes"] == "on",
		"trimmed-strings":  flags["trim"] == "on",
		"outliers-handled": flags["outlier"] == "clip" || flags["outlier"] == "winsorize",
	}
	passed := []ax.Value{}
	failed := []ax.Value{}
	for _, c := range checks {
		if ok[c] {
			passed = append(passed, c)
		} else {
			failed = append(failed, ax.Object("check", c, "fix", remedies[c]))
		}
	}
	score := math.Round(float64(len(passed))/float64(len(checks))*100) / 100
	return ax.Object(
		"score", score,
		"solved", len(passed) == len(checks),
		"passed", ax.Array(passed...),
		"failed", ax.Array(failed...),
		"logs", fmt.Sprintf("%d/%d checks passed", len(passed), len(checks)),
	)
}

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	client := openAIClient()

	// An independent verifier -- a separate ax() program, not the agent grading itself.
	verifier := ax.NewAx(
		"rubric:string, evidence:json -> passed:boolean, feedback:string, missing:string[]",
		map[string]ax.Value{"instruction": "You are an independent rubric grader, not a self-critique. Pass only when the evidence clearly satisfies every part of the rubric."},
	)

	// In-memory rule store. Verified, reusable rules go here -- not raw failure notes.
	memoryStore := map[string]string{}
	memoryOrder := []string{}
	storeRule := func(key, value string) {
		if _, seen := memoryStore[key]; !seen {
			memoryOrder = append(memoryOrder, key)
		}
		memoryStore[key] = value
	}

	runtime := axgoja.NewRuntime(
		axgoja.WithCallable("runExperiment", func(p ax.Value) (ax.Value, error) {
			return runInSandbox(asString(asMap(p)["plan"])), nil
		}),
		axgoja.WithCallable("listChecks", func(p ax.Value) (ax.Value, error) {
			out := []ax.Value{}
			for _, c := range checks {
				out = append(out, c)
			}
			return ax.Array(out...), nil
		}),
		axgoja.WithCallable("grade", func(p ax.Value) (ax.Value, error) {
			m := asMap(p)
			evidence := m["evidence"]
			if evidence == nil {
				evidence = ax.Array()
			}
			return verifier.Forward(ctx, client, map[string]ax.Value{"rubric": asString(m["rubric"]), "evidence": evidence}, nil)
		}),
		axgoja.WithCallable("recallRules", func(p ax.Value) (ax.Value, error) {
			t := strings.ToLower(asString(asMap(p)["topic"]))
			words := strings.Fields(t)
			out := []ax.Value{}
			for _, k := range memoryOrder {
				match := strings.Contains(k, t)
				if !match {
					for _, w := range words {
						if strings.Contains(k, w) {
							match = true
							break
						}
					}
				}
				if match {
					out = append(out, memoryStore[k])
				}
			}
			return ax.Array(out...), nil
		}),
		axgoja.WithCallable("remember", func(p ax.Value) (ax.Value, error) {
			m := asMap(p)
			rule := asString(m["rule"])
			key := strings.ToLower(rule)
			if len(key) > 48 {
				key = key[:48]
			}
			storeRule(key, fmt.Sprintf("%s :: %s", rule, asString(m["evidence"])))
			return ax.Object("stored", true, "total", len(memoryStore)), nil
		}),
	)

	spec := func(name, description string, props map[string]ax.Value, required ...string) ax.Value {
		parameters := ax.Object("type", "object", "properties", props)
		if len(required) > 0 {
			reqd := []ax.Value{}
			for _, r := range required {
				reqd = append(reqd, r)
			}
			parameters["required"] = ax.Array(reqd...)
		}
		return ax.Object("name", name, "description", description, "parameters", parameters)
	}

	selfImproving := ax.NewAgent(
		`goal:string, rubric:string -> answer:string, experiments:string[] "Plans tried, in order", learnedRules:string[]`,
		map[string]ax.Value{
			"contextFields": ax.Array(),
			"functions": ax.Array(
				spec("runExperiment", "Apply an ETL config plan; returns score, solved, passed[], failed[{check,fix}], logs. Pass an empty plan to discover the fixes.", map[string]ax.Value{"plan": ax.Object("type", "string")}, "plan"),
				spec("listChecks", "List the data-quality checks the experiment evaluates.", map[string]ax.Value{}),
				spec("grade", "Independent rubric grader. Pass only when the evidence meets the rubric.", map[string]ax.Value{"rubric": ax.Object("type", "string"), "evidence": ax.Object("type", "array", "items", ax.Object("type", "string"))}, "rubric", "evidence"),
				spec("recallRules", "Recall verified rules relevant to a topic.", map[string]ax.Value{"topic": ax.Object("type", "string")}, "topic"),
				spec("remember", "Store a verified, reusable rule (the rule, not raw notes).", map[string]ax.Value{"rule": ax.Object("type", "string"), "evidence": ax.Object("type", "string")}, "rule", "evidence"),
			),
			"contextPolicy": ax.Object("preset", "adaptive", "budget", "balanced"),
			"executorOptions": ax.Object("description", strings.Join([]string{
				"Use the tools -- do not answer from your own knowledge.",
				"1. recallRules('etl data quality') to reuse anything already learned.",
				"2. runExperiment('') once to see every failing check and its fix.",
				"3. Build a plan applying all the fixes, then runExperiment again. Repeat until solved is true.",
				"4. grade the passing evidence against the rubric.",
				"5. For each check you fixed, remember(rule, evidence).",
				"6. Then return the answer, the plans you tried, and the learned rules.",
			}, "\n")),
			"runtime": ax.Object("language", "JavaScript"),
		},
	)

	result, err := selfImproving.Forward(
		ctx,
		client,
		map[string]ax.Value{
			"goal":   "Find an ETL config plan that cleans the dirty dataset so every data-quality check passes.",
			"rubric": "All five checks (no-nulls, no-duplicates, numeric-types, trimmed-strings, outliers-handled) must pass, i.e. score 1.0.",
		},
		map[string]ax.Value{"runtime": runtime, "max_actor_steps": 18},
	)
	if err != nil {
		panic(err)
	}

	printJSON(result)

	// Persist the agent's verified rules so a future run's recall reuses them.
	if learned, ok := asMap(result)["learnedRules"].([]ax.Value); ok {
		for _, rule := range learned {
			r := asString(rule)
			key := strings.ToLower(r)
			if len(key) > 48 {
				key = key[:48]
			}
			storeRule(key, r)
		}
	}
	fmt.Printf("\nMemory now holds %d rule(s) for next time.\n", len(memoryStore))
}
