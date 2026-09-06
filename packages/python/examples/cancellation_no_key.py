from axllm import AxAIServiceAbortedError, AxCancellationToken, OpenAICompatibleClient


class CountingTransport:
    def __init__(self):
        self.calls = 0

    def __call__(self, _request):
        self.calls += 1
        return {"status": 200, "json": {}}


transport = CountingTransport()
client = OpenAICompatibleClient(
    api_key="test-key",
    model="gpt-5.6-luna",
    transport=transport,
)
token = AxCancellationToken()
assert token.cancel("user stopped") is True
assert token.cancel("later reason") is False

try:
    client.chat(
        {"chat_prompt": [{"role": "user", "content": "This must not be sent."}]},
        {"cancellation": token},
    )
    raise AssertionError("pre-cancelled request unexpectedly completed")
except AxAIServiceAbortedError as error:
    assert error.reason == "user stopped"
    assert error.retryable is False

assert transport.calls == 0
print("python-cancellation-no-key user stopped")
