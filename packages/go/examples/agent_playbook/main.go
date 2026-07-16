package main

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	ax "github.com/ax-llm/ax/packages/go"
)

// The actor returns model-authored Python code and a real runtime executes it.
// The same offline response also satisfies the playbook reflector and curator.
type scriptedClient struct{}

func (c *scriptedClient) Chat(context.Context, map[string]ax.Value, map[string]ax.Value) (ax.Value, error) {
	content := "{" +
		"\"pythonCode\":\"final('Answer', {'answer': 'Ax composes typed LLM programs.'})\"," +
		"\"answer\":\"Ax composes typed LLM programs.\"," +
		"\"reasoning\":\"The playbook lacked a brevity rule.\"," +
		"\"errorIdentification\":\"Answer was too verbose.\"," +
		"\"rootCauseAnalysis\":\"No guidance on conciseness.\"," +
		"\"correctApproach\":\"Add a concise-answer guideline.\"," +
		"\"keyInsight\":\"Prefer one-sentence answers.\"," +
		"\"weaknessDescription\":\"The agent does not verify its final step.\"," +
		"\"rootCause\":\"The final step is accepted without a check.\"," +
		"\"proposedGuidance\":\"Verify the final step before completing the task.\"," +
		"\"evidenceQuotes\":[\"final\",\"snapshot\",\"Answer\"]," +
		"\"configRecommendations\":[]," +
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

type runtimeSession struct{}

func (s *runtimeSession) Execute(code string, _ map[string]ax.Value) ax.Value {
	if strings.Contains(code, "pythonCode") {
		panic("runtime received a response wrapper instead of code")
	}
	return ax.Object("type", "final", "args", ax.Array("Answer", ax.Object("answer", "Ax composes typed LLM programs.")))
}
func (s *runtimeSession) Inspect(map[string]ax.Value) ax.Value { return ax.Object() }
func (s *runtimeSession) SnapshotGlobals(map[string]ax.Value) ax.Value {
	return ax.Object("version", 1, "bindings", ax.Object(), "globals", ax.Object(), "closed", false)
}
func (s *runtimeSession) PatchGlobals(value ax.Value, _ map[string]ax.Value) ax.Value { return value }
func (s *runtimeSession) Close() ax.Value { return ax.Object("closed", true) }

type runtime struct{}

func (r *runtime) Language() string { return "Python" }
func (r *runtime) UsageInstructions() string { return "" }
func (r *runtime) CreateSession(map[string]ax.Value, map[string]ax.Value) (ax.CodeSession, error) {
	return &runtimeSession{}, nil
}

func main() {
	client := &scriptedClient{}
	runtime := &runtime{}
	// agent.Playbook() binds an evolving context playbook to an agent stage. The
	// "responder" target grows the user-facing answer stage; ACE remains an
	// implementation detail behind Playbook(), just as Optimize() hides GEPA.
	agent := ax.NewAgent("question:string -> answer:string", ax.Object(
		"name", "qa", "description", "Answer the question.", "ai", client, "runtime", runtime,
	))

	pb := agent.Playbook(map[string]ax.Value{"target": "responder", "studentAI": client, "maxEpochs": 1})
	dataset := ax.Object(
		"train", ax.Array(ax.Object("input", ax.Object("question", "Answer briefly."), "score", 0)),
	)

	// A zero minimum gain exercises verified acceptance. A positive minimum gain
	// rejects the same flat score and must restore the exact pre-proposal snapshot.
	accepted, err := pb.EvolveAgent(
		context.Background(),
		dataset,
		map[string]ax.Value{"verify": true, "minHeldInGain": 0, "maxProposals": 1, "maxMetricCalls": 2},
	)
	if err != nil {
		panic(err)
	}
	beforeRejection, _ := json.Marshal(pb.ToJSON())
	rejected, err := pb.EvolveAgent(
		context.Background(),
		dataset,
		map[string]ax.Value{"verify": true, "minHeldInGain": 0.1, "maxProposals": 1, "maxMetricCalls": 2},
	)
	if err != nil {
		panic(err)
	}
	afterRejection, _ := json.Marshal(pb.ToJSON())
	acceptedMap := accepted.(map[string]ax.Value)
	rejectedMap := rejected.(map[string]ax.Value)
	acceptedOutcome := acceptedMap["outcomes"].([]ax.Value)[0].(map[string]ax.Value)
	rejectedOutcome := rejectedMap["outcomes"].([]ax.Value)[0].(map[string]ax.Value)
	if fmt.Sprint(acceptedMap["metricCallsUsed"]) != "2" || acceptedOutcome["accepted"] != true {
		panic(fmt.Sprintf("verified acceptance failed: %v", accepted))
	}
	if fmt.Sprint(rejectedMap["metricCallsUsed"]) != "2" || rejectedOutcome["accepted"] != false {
		panic(fmt.Sprintf("verified rejection failed: %v", rejected))
	}
	if string(afterRejection) != string(beforeRejection) { panic("rejected proposal was not rolled back exactly") }
	stateMap, _ := pb.ToJSON().(map[string]ax.Value)
	if _, ok := stateMap["playbook"]; !ok {
		panic(fmt.Sprintf("missing playbook: %v", stateMap))
	}
	fmt.Println("accepted:", acceptedOutcome)
	fmt.Println("rejected:", rejectedOutcome)
	fmt.Println("go-agent-playbook-ok")
}
