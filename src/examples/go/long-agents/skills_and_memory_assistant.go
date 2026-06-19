// ax-example:start
// title: Go Skills + Memory Ops Assistant
// group: long-agents
// description: An on-call assistant that recalls past decisions from a memory store and loads the right runbook skill on demand, using the agent skills and memories subsystems.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 50
// ax-example:end
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	ax "github.com/ax-llm/ax/go"
	axgoja "github.com/ax-llm/ax/go/runtime/goja"
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
		// gpt-4o (not -mini): the recall/discover loop needs reasoning to proactively
		// pull memories + runbooks instead of stopping to ask for clarification.
		model = "gpt-4o"
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

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	client := openAIClient()

	// ---------------------------------------------------------------------------
	// Memory store -- remembered decisions and postmortems. In production this is a
	// vector DB / BM25 index; here a tiny set surfaced to the actor on demand. The
	// actor pulls relevant entries into scope via `await recall([...])`; the host
	// returns the matching entries (here, all of them on any search).
	// ---------------------------------------------------------------------------
	memories := ax.Array(
		ax.Object("id", "decision/db-failover", "content", "Decision (2026-02): during a primary DB failover, freeze writes via the feature flag `writes.enabled=false` BEFORE promoting the replica. Promoting first caused split-brain in inc-118."),
		ax.Object("id", "postmortem/inc-118", "content", "inc-118 root cause: replica promoted while primary still accepted writes. Mitigation: write-freeze flag + 90s replication-lag gate."),
		ax.Object("id", "decision/customer-comms", "content", "Decision: for Sev-1s affecting enterprise tenants, post a status-page update within 15 minutes and notify named TAMs directly."),
	)

	// ---------------------------------------------------------------------------
	// Skill store -- runbooks loaded into the executor prompt on demand via
	// `await discover({ skills: [...] })`. Loaded skills persist across calls.
	// ---------------------------------------------------------------------------
	skills := ax.Array(
		ax.Object("id", "runbook-db-failover", "name", "DB failover runbook", "content", "## DB failover\n1. Set `writes.enabled=false`.\n2. Wait for replication lag < 5s.\n3. Promote replica.\n4. Re-point app via service discovery.\n5. Re-enable writes. 6. File postmortem within 48h."),
		ax.Object("id", "runbook-status-comms", "name", "Status communications runbook", "content", "## Status comms\n- Sev-1: status-page update within 15m, every 30m thereafter.\n- Enterprise impact: notify named TAMs directly.\n- Keep updates factual; no ETAs you cannot keep."),
	)

	// Dynamic host-side search: the actor's recall()/discover() queries arrive here and
	// we substring-match them against the stores (a BM25 / vector index in production).
	// This is the native onMemoriesSearch / onSkillsSearch callback path -- it receives
	// the actor's actual search terms, unlike static preloaded results.
	// Token-based matching (a stand-in for BM25/vector): an entry matches if any word of
	// any search query (len >= 3) appears in it -- robust to phrase queries from the actor.
	tokenize := func(q ax.Value) []string {
		var toks []string
		for _, t := range strings.FieldsFunc(strings.ToLower(fmt.Sprint(q)), func(r rune) bool {
			return !((r >= 'a' && r <= 'z') || (r >= '0' && r <= '9'))
		}) {
			if len(t) >= 3 {
				toks = append(toks, t)
			}
		}
		return toks
	}
	memoriesSearch := ax.AxMemoriesSearchFn(func(searches []ax.Value, alreadyLoaded []ax.Value) []ax.Value {
		loaded := map[string]bool{}
		for _, m := range alreadyLoaded {
			if mm, ok := m.(map[string]ax.Value); ok {
				loaded[fmt.Sprint(mm["id"])] = true
			}
		}
		seen := map[string]bool{}
		out := []ax.Value{}
		for _, q := range searches {
			for _, tok := range tokenize(q) {
				for _, m := range memories {
					mm, _ := m.(map[string]ax.Value)
					id := fmt.Sprint(mm["id"])
					if loaded[id] || seen[id] {
						continue
					}
					if strings.Contains(strings.ToLower(id+" "+fmt.Sprint(mm["content"])), tok) {
						out = append(out, m)
						seen[id] = true
					}
				}
			}
		}
		return out
	})
	skillsSearch := ax.AxSkillsSearchFn(func(searches []ax.Value) []ax.Value {
		seen := map[string]bool{}
		out := []ax.Value{}
		for _, q := range searches {
			for _, tok := range tokenize(q) {
				for _, s := range skills {
					ss, _ := s.(map[string]ax.Value)
					id := fmt.Sprint(ss["id"])
					if seen[id] {
						continue
					}
					if strings.Contains(strings.ToLower(fmt.Sprint(ss["id"])+" "+fmt.Sprint(ss["name"])+" "+fmt.Sprint(ss["content"])), tok) {
						out = append(out, s)
						seen[id] = true
					}
				}
			}
		}
		return out
	})

	assistant := ax.NewAgent(
		`situation:string -> guidance:string "What to do, grounded in our decisions and runbooks", steps:string[]`,
		map[string]ax.Value{
			"contextFields": ax.Array(),
			// A base skill always loaded, independent of search.
			"skills": ax.Array(
				ax.Object("name", "house-style", "content", "Be concise and operational. Prefer our remembered decisions over generic advice. Never invent flag names or steps -- cite the runbook."),
			),
			// Native host search callbacks -- the actor's recall()/discover() reach these.
			// Their presence auto-enables the memory + skill subsystems (so the actor's
			// prompt advertises recall()/discover()), mirroring the TS/Python API.
			"onMemoriesSearch": memoriesSearch,
			"onSkillsSearch":   skillsSearch,
			"executorOptions": ax.Object("description", strings.Join([]string{
				"You do NOT know our internal flag names, incident history, or runbook steps from your own training.",
				"The only source of truth is our memory (past decisions/postmortems) and our runbook skills.",
				"1. recall the relevant past decisions and postmortems (e.g. the failover decision, inc-118).",
				"2. discover the matching runbook skill and read its exact steps and flag names.",
				"3. Answer with the precise ordered procedure, citing our exact flag names and runbook steps.",
				"Generic best-practice advice is WRONG here. Do NOT answer from general knowledge and do NOT ask for clarification -- recall and discover first.",
			}, "\n")),
			"runtime": ax.Object("language", "JavaScript"),
		},
	)

	result, err := assistant.Forward(
		ctx,
		client,
		map[string]ax.Value{
			"situation": "Our primary database is unhealthy and we're about to fail over -- the same class of " +
				"incident as inc-118, and enterprise checkout is affected. Per our remembered decisions " +
				"and runbooks: what is the exact ordered procedure, and which specific feature flag must " +
				"we set before promoting the replica?",
		},
		map[string]ax.Value{"runtime": axgoja.NewRuntime(), "max_actor_steps": 12},
	)
	if err != nil {
		panic(err)
	}

	fmt.Println("\n=== Response ===")
	printJSON(result)
}
