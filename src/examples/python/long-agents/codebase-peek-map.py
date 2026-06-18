# ax-example:start
# title: Python Codebase Q&A with a Peek Context Map
# group: long-agents
# description: Answers several dependency questions over one large module index by building and reusing an evolving context map (the "peek" orientation cache), so later questions skip re-scanning the corpus.
# provider: google-gemini
# env: GOOGLE_APIKEY
# level: advanced
# order: 20
# ax-example:end
import json
import os

from axllm import GoogleGeminiClient, agent
from axllm.runtime_quickjs import AxQuickJsCodeRuntime

api_key = os.getenv("GOOGLE_APIKEY")
if not api_key:
    raise SystemExit("Set GOOGLE_APIKEY to run this example.")

client = GoogleGeminiClient(api_key=api_key, model="gemini-3-flash-preview")


# ---------------------------------------------------------------------------
# A large module-dependency index for a monorepo. Each block is a record the
# agent must *search* to answer -- the answers cannot be guessed, only computed
# by filtering the index. Generated large so it would not fit comfortably in a
# prompt; it lives in contextFields and is queried from the runtime.
# ---------------------------------------------------------------------------
def build_module_index():
    core = [
        {"path": "packages/api/middleware/auth.ts", "imports": ["packages/shared"], "writes": "-"},
        {"path": "packages/api/middleware/rateLimit.ts", "imports": ["packages/db"], "writes": "-"},
        {"path": "packages/api/routes/checkout.ts", "imports": ["packages/api/middleware/auth.ts", "packages/services/orders/createOrder.ts", "packages/services/payments/charge.ts"], "writes": "-"},
        {"path": "packages/api/routes/search.ts", "imports": ["packages/api/middleware/auth.ts", "packages/services/catalog/searchCatalog.ts"], "writes": "-"},
        {"path": "packages/services/orders/createOrder.ts", "imports": ["packages/db", "packages/clients/bus"], "writes": "orders"},
        {"path": "packages/services/orders/orderRepo.ts", "imports": ["packages/db"], "writes": "orders"},
        {"path": "packages/services/payments/charge.ts", "imports": ["packages/clients/acquirer", "packages/db"], "writes": "payments"},
        {"path": "packages/services/payments/refund.ts", "imports": ["packages/clients/acquirer", "packages/db"], "writes": "refunds"},
        {"path": "packages/services/catalog/searchCatalog.ts", "imports": ["packages/db"], "writes": "-"},
        {"path": "packages/clients/acquirer/index.ts", "imports": ["packages/shared"], "writes": "-"},
        {"path": "packages/clients/bus/index.ts", "imports": ["packages/shared"], "writes": "-"},
    ]
    # Filler modules so the index is genuinely large; some also depend on the acquirer.
    filler = []
    for i in range(110):
        filler.append({
            "path": f"packages/services/feature{i}/handler.ts",
            "imports": ["packages/clients/acquirer" if i % 4 == 0 else "packages/db", "packages/shared"],
            "writes": "audit" if i % 6 == 0 else "-",
        })
    return core + filler


modules = build_module_index()
codebase_index = "\n\n".join(
    f"PATH: {m['path']}\nIMPORTS: {', '.join(m['imports'])}\nWRITES: {m['writes']}" for m in modules
)
print(f"Module index: {len(modules)} records (kept out of the prompt).")

analyst = agent(
    'context:string, question:string -> answer:string, paths:string[] "Exact PATH values from the index that answer the question"',
    {
        "contextFields": ["context"],
        "contextPolicy": {"preset": "adaptive", "budget": "balanced"},
        "contextOptions": {
            "description": "The context is a module index of \"PATH / IMPORTS / WRITES\" records. Answer by filtering those records in code -- never guess. Return exact PATH values verbatim.",
        },
        # The Peek context map: small, persistent orientation reused across queries.
        "contextMap": {"maxChars": 1800, "infiniteEvolve": False, "evolveSteps": 1},
        "runtime": {"language": "JavaScript"},
    },
)

questions = [
    "Which modules import 'packages/clients/acquirer'? Give the exact PATH values.",
    "Which modules write to the 'orders' table?",
    "What are the direct IMPORTS of packages/api/routes/checkout.ts?",
]

for question in questions:
    result = analyst.forward(
        client,
        {"context": codebase_index, "question": question},
        {"runtime": AxQuickJsCodeRuntime(), "max_actor_steps": 24},
    )
    print("\nQ:", question)
    print("A:", result.get("answer"))
    print("Paths:", ", ".join(result.get("paths") or []))

print("\nThe context map evolved on the first query and was reused for the rest.")
