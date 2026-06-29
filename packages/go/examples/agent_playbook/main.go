package main

import (
	"context"
	"fmt"

	ax "github.com/ax-llm/ax/packages/go"
)

// scriptedClient stands in for a real provider so this example runs without a
// key. Swap it for ax.NewAI("openai", ...) to grow a playbook against a live
// model. The canned JSON satisfies the agent's bound stage AND the playbook's
// internal reflector/curator sub-programs, so the full ACE loop is exercised
// offline.
type scriptedClient struct{}

func (c *scriptedClient) Chat(context.Context, map[string]ax.Value, map[string]ax.Value) (ax.Value, error) {
	content := "{" +
		"\"answer\":\"Ax composes typed LLM programs.\"," +
		"\"reasoning\":\"The playbook lacked a brevity rule.\"," +
		"\"errorIdentification\":\"Answer was too verbose.\"," +
		"\"rootCauseAnalysis\":\"No guidance on conciseness.\"," +
		"\"correctApproach\":\"Add a concise-answer guideline.\"," +
		"\"keyInsight\":\"Prefer one-sentence answers.\"," +
		"\"bulletTags\":[]," +
		"\"operations\":[{\"type\":\"ADD\",\"section\":\"Guidelines\",\"content\":\"Answer in one concise sentence.\"}]" +
		"}"
	return ax.Object("results", ax.Array(ax.Object("content", content))), nil
}

func (c *scriptedClient) Embed(context.Context, map[string]ax.Value, map[string]ax.Value) (ax.Value, error) {
	return ax.Object("embeddings", ax.Array(ax.Array(1.0, 2.0))), nil
}

func (c *scriptedClient) Stream(context.Context, map[string]ax.Value, map[string]ax.Value) ([]ax.Value, error) {
	return nil, nil
}

func main() {
	client := &scriptedClient{}
	// agent.Playbook() binds an evolving context playbook to an agent stage. The
	// "responder" target grows the user-facing answer stage; ACE remains an
	// implementation detail behind Playbook(), just as Optimize() hides GEPA.
	agent := ax.NewAgent("question:string -> answer:string", ax.Object("name", "qa", "description", "Answer the question.", "ai", client))

	pb := agent.Playbook(map[string]ax.Value{"target": "responder", "studentAI": client, "maxEpochs": 1})

	metric := func(args map[string]ax.Value) ax.Value {
		prediction, _ := args["prediction"].(map[string]ax.Value)
		if prediction != nil {
			if answer, ok := prediction["answer"].(string); ok && answer != "" {
				return 1.0
			}
		}
		return 0.0
	}

	examples := []ax.Value{
		ax.Object("question", "What is Ax?", "contextData", ax.Object()),
		ax.Object("question", "Why typed signatures?", "contextData", ax.Object()),
	}
	result, err := pb.Evolve(context.Background(), examples, metric, nil)
	if err != nil {
		panic(err)
	}
	rendered := pb.Render()
	resultMap, _ := result.(map[string]ax.Value)
	if _, ok := resultMap["bestScore"]; !ok {
		panic(fmt.Sprintf("missing bestScore: %v", result))
	}
	stateMap, _ := pb.ToJSON().(map[string]ax.Value)
	if _, ok := stateMap["playbook"]; !ok {
		panic(fmt.Sprintf("missing playbook: %v", stateMap))
	}
	fmt.Println("rendered:", rendered)
	fmt.Println("go-agent-playbook-ok")
}
