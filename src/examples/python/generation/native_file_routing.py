# ax-example:start
# title: Python Native File Routing
# group: generation
# description: Summarizes a PDF through a provider router without replacing the native file with extracted text.
# provider: openai
# env: OPENAI_API_KEY, OPENAI_APIKEY, AX_PDF_BASE64
# level: intermediate
# order: 53
# ax-example:end
import json
import os
from axllm import ai, ax, ProviderRouter

client = ai("openai", api_key=os.getenv("OPENAI_API_KEY") or os.environ["OPENAI_APIKEY"], model="gpt-6-astra", model_config={"thinkingTokenBudget": "low"})
router = ProviderRouter({"providers": {"primary": client}})
program = ax("document:file -> summary:string")
result = program.forward(router, {"document": {"filename": "report.pdf", "mimeType": "application/pdf", "data": os.environ["AX_PDF_BASE64"]}}, {"serviceTier": "standard"})
print(json.dumps(result, indent=2))
