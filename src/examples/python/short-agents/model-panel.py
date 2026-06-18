# ax-example:start
# title: Python Multi-Model Panel
# group: short-agents
# description: Fans one question across three providers (OpenAI, Gemini, Anthropic), then judges the candidates and synthesizes a single grounded answer.
# provider: openai
# env: OPENAI_API_KEY, OPENAI_APIKEY, GOOGLE_APIKEY, ANTHROPIC_APIKEY
# level: advanced
# order: 40
# ax-example:end
import json
import os

from axllm import AnthropicClient, GoogleGeminiClient, OpenAICompatibleClient, ax

openai_key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_APIKEY")
google_key = os.getenv("GOOGLE_APIKEY") or os.getenv("GOOGLE_API_KEY")
anthropic_key = os.getenv("ANTHROPIC_APIKEY") or os.getenv("ANTHROPIC_API_KEY")
if not (openai_key and google_key and anthropic_key):
    raise SystemExit("Set OPENAI_APIKEY, GOOGLE_APIKEY, and ANTHROPIC_APIKEY to run this multi-provider panel.")

# A panel of three different providers, each answering the same question
# independently. Plain ax() composition (no agent runtime): fan out to the
# panel, judge the candidates, then synthesize one grounded answer.
panel = [
    ("openai/gpt-4o-mini", OpenAICompatibleClient(api_key=openai_key, model="gpt-4o-mini", model_config={"temperature": 0})),
    ("google/gemini-3-flash", GoogleGeminiClient(api_key=google_key, model="gemini-3-flash-preview")),
    ("anthropic/claude-haiku-4.5", AnthropicClient(api_key=anthropic_key, model="claude-haiku-4-5")),
]

researcher = ax("question:string -> answer:string, keyFindings:string[], citations:string[], confidence:number")
researcher.set_instruction("Answer independently. Use evidence. Call out uncertainty. Do not optimize for consensus.")

judge = ax("question:string, candidates:json -> consensus:string[], contradictions:string[], uniqueInsights:string[], blindSpots:string[]")
judge.set_instruction("Compare the candidates. Find agreement, conflicts, missing coverage, and unique useful points.")

synthesizer = ax("question:string, candidates:json, review:json -> answer:string, citations:string[], caveats:string[]")
synthesizer.set_instruction("Write one final answer grounded in the candidates and review. Resolve conflicts explicitly.")

question = "What are the strongest arguments for and against a national carbon tax?"

candidates = []
for model, client in panel:
    response = researcher.forward(client, {"question": question})
    candidates.append({"model": model, **response})

# The judge + synthesizer run on one of the panel clients (OpenAI here).
orchestrator = panel[0][1]
review = judge.forward(orchestrator, {"question": question, "candidates": candidates})
final = synthesizer.forward(orchestrator, {"question": question, "candidates": candidates, "review": review})

print(json.dumps(final, indent=2, sort_keys=True))
