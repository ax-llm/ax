# ax-example:start
# title: Python Model Catalog
# group: generation
# description: Lists static models and named OpenAI-compatible profiles with portable thinking levels and service tiers.
# provider: openai-compatible
# env: none
# level: beginner
# order: 16
# ax-example:end
from axllm import get_supported_ai_models


catalog = get_supported_ai_models()
providers = {entry["name"]: entry for entry in catalog}
azure = providers["azure-openai"]
openrouter = providers["openrouter"]

assert azure["isDynamic"] is True and azure["models"] == []
assert "high" in azure["capabilities"]["thinkingLevels"]
assert "priority" in azure["capabilities"]["serviceTiers"]
assert "flex" in openrouter["capabilities"]["serviceTiers"]

print(f"{len(catalog)} providers; Azure and OpenRouter named profiles are available")
