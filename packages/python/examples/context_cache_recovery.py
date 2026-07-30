import json
import os
import time

from axllm import GoogleGeminiClient


def chat_response(text):
    return {"status": 200, "json": {"candidates": [{"content": {"parts": [{"text": text}]}, "finishReason": "STOP"}]}}


class ScriptedTransport:
    def __init__(self, responses):
        self.responses = list(responses)
        self.requests = []

    def __call__(self, request):
        self.requests.append(request)
        return self.responses.pop(0)


def client(transport):
    return GoogleGeminiClient(model="gemini-3.5-flash", api_key="gemini-key", transport=transport, contextCache={"minTokens": 0, "ttlSeconds": 3600, "refreshWindowSeconds": 300})


request = {"chat_prompt": [{"role": "system", "content": "stable context"}, {"role": "user", "content": "answer briefly"}]}
future = lambda seconds: int(time.time() * 1000) + seconds * 1000

recovery = ScriptedTransport([
    {"status": 200, "json": {"name": "cachedContents/cache-1", "expireTime": future(3600)}},
    {"status": 400, "json": {"error": {"message": "cachedContent is invalid"}}},
    chat_response("uncached recovery"),
])
assert client(recovery).chat(request)["results"][0]["content"] == "uncached recovery"
assert [item["method"] for item in recovery.requests] == ["POST", "POST", "POST"]
assert "cachedContent" in recovery.requests[1]["json"] and "cachedContent" not in recovery.requests[2]["json"]

refresh = ScriptedTransport([
    {"status": 200, "json": {"name": "cachedContents/old", "expireTime": future(1)}}, chat_response("old"),
    {"status": 500, "json": {"error": {"message": "refresh failed"}}},
    {"status": 200, "json": {"name": "cachedContents/new", "expireTime": future(3600)}}, chat_response("recreated"),
])
refresh_client = client(refresh)
refresh_client.chat(request)
assert refresh_client.chat(request)["results"][0]["content"] == "recreated"
assert [item["method"] for item in refresh.requests] == ["POST", "POST", "PATCH", "POST", "POST"]

fallback = ScriptedTransport([
    {"status": 200, "json": {"name": "cachedContents/old", "expireTime": future(1)}}, chat_response("old"),
    {"status": 500, "json": {"error": {"message": "refresh failed"}}},
    {"status": 500, "json": {"error": {"message": "recreate failed"}}}, chat_response("uncached fallback"),
])
fallback_client = client(fallback)
fallback_client.chat(request)
assert fallback_client.chat(request)["results"][0]["content"] == "uncached fallback"
assert [item["method"] for item in fallback.requests] == ["POST", "POST", "PATCH", "POST", "POST"]

if os.getenv("AX_CONTEXT_CACHE_LIVE") == "1":
    key = os.getenv("GOOGLE_APIKEY") or os.getenv("GOOGLE_API_KEY")
    if not key:
        raise SystemExit("Set GOOGLE_APIKEY to run the live Gemini cache exercise")
    entries = {}
    registry = {"get": lambda namespace, cache_key: entries.get((namespace, cache_key)), "set": lambda namespace, cache_key, entry: entries.__setitem__((namespace, cache_key), entry)}
    live = GoogleGeminiClient(model=os.getenv("AX_GEMINI_MODEL", "gemini-3.5-flash"), api_key=key, contextCache={"minTokens": 0, "ttlSeconds": 60, "refreshWindowSeconds": 120, "namespace": "live-example", "registry": registry})
    live_request = {"chat_prompt": [{"role": "system", "content": "This is stable reference context. " * 4000}, {"role": "user", "content": "Reply with the word ready."}]}
    live.chat(live_request)
    first_expiry = next(iter(entries.values()))["expiresAt"]
    live.chat(live_request)
    second_expiry = next(iter(entries.values()))["expiresAt"]
    assert second_expiry >= first_expiry
    print(json.dumps({"live": True, "createdExpiry": first_expiry, "refreshedExpiry": second_expiry}))
else:
    print("python-context-cache-recovery-ok")
