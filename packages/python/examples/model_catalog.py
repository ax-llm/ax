from axllm import get_supported_ai_models


catalog = get_supported_ai_models()
providers = {entry["name"]: entry for entry in catalog}
azure = providers["azure-openai"]
openrouter = providers["openrouter"]

assert azure["isDynamic"] is True and azure["models"] == []
assert "high" in azure["capabilities"]["thinkingLevels"]
assert "priority" in azure["capabilities"]["serviceTiers"]
assert openrouter["isDynamic"] is True and "flex" in openrouter["capabilities"]["serviceTiers"]
assert all(entry["name"] in {item["name"] for item in get_supported_ai_models("text")} for entry in (azure, openrouter))

print("python-model-catalog-ok")
