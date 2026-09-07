# ax-example:start
# title: Python Portable Cancellation
# group: generation
# description: Cancels a provider request before transport and preserves the first cancellation reason.
# provider: openai-compatible
# env: none
# level: intermediate
# order: 46
# ax-example:end
from axllm import AxAIServiceAbortedError, AxCancellationToken, OpenAICompatibleClient


class CountingTransport:
    def __init__(self):
        self.calls = 0

    def __call__(self, _request):
        self.calls += 1
        return {"status": 200, "json": {}}


transport = CountingTransport()
client = OpenAICompatibleClient(api_key="test-key", model="gpt-5.6-luna", transport=transport)
token = AxCancellationToken()
assert token.cancel("user stopped")
assert not token.cancel("later reason")

try:
    client.chat(
        {"chat_prompt": [{"role": "user", "content": "This must not be sent."}]},
        {"cancellation": token},
    )
except AxAIServiceAbortedError as error:
    assert error.reason == "user stopped" and not error.retryable
else:
    raise AssertionError("pre-cancelled request unexpectedly completed")

assert transport.calls == 0
print("cancelled before transport: user stopped")
