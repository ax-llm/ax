#include "axllm/axllm.hpp"

#include <cstdlib>
#include <iostream>
#include <string>
#include <vector>

// Drive a realtime audio TURN through the productized realtime_chat driver using
// ScriptedRealtimeTransport: the deterministic, credential-free path that
// exercises the full send-setup -> send-input -> fold -> merge loop without a
// live socket (the live socket path is verified separately against the real
// API). Exits non-zero on any mismatch so `axir verify` fails if it regresses.
namespace {
[[noreturn]] void fail(const std::string& message, const axllm::Value& detail) {
  std::cout << "realtime-audio-turn FAIL: " << message << " " << axllm::stringify(detail) << "\n";
  std::exit(1);
}
}  // namespace

int main() {
  axllm::GrokClient client(axllm::object({
      {"model", "grok-voice-think-fast-1.0"},
      {"api_key", "test-key"},
  }));
  axllm::Value request = axllm::object({
      {"model", "grok-voice-think-fast-1.0"},
      {"chat_prompt",
       axllm::array({
           axllm::object({{"role", "system"}, {"content", "You are a concise voice agent."}}),
           axllm::object({{"role", "user"}, {"content", "Say hello."}}),
       })},
      {"audio", axllm::object({{"output", axllm::object({{"voice", "eve"}})}})},
  });
  // Canned server frames: session handshake, two transcript deltas, an audio
  // delta, then the terminal response.done.
  std::vector<axllm::Value> inbound = {
      axllm::object({{"type", "session.created"}}),
      axllm::object({{"type", "session.updated"}}),
      axllm::object({{"type", "response.output_audio_transcript.delta"}, {"response_id", "rt"}, {"delta", "hel"}}),
      axllm::object({{"type", "response.output_audio_transcript.delta"}, {"response_id", "rt"}, {"delta", "lo"}}),
      axllm::object({{"type", "response.output_audio.delta"}, {"response_id", "rt"}, {"delta", "AQI="}}),
      axllm::object({{"type", "response.done"}, {"response", axllm::object({{"id", "rt"}, {"usage", axllm::object({{"input_tokens", 3}, {"output_tokens", 2}, {"total_tokens", 5}})}})}}),
  };

  axllm::ScriptedRealtimeTransport transport(inbound);
  axllm::Value final_response = client.realtime_chat(request, &transport);

  std::string sent;
  for (const auto& event : transport.sent) sent += axllm::stringify(axllm::Core::get(event, "type")) + " ";
  std::cout << "driver sent: " << sent << "\n";
  std::cout << "merged result: " << axllm::stringify(final_response) << "\n";

  axllm::Value result;
  for (const auto& entry : axllm::Core::iter(axllm::Core::get(final_response, "results"))) {
    result = entry;
    break;
  }

  // The driver must send the Core-built session.update first, then the inputs.
  if (sent != "\"session.update\" \"conversation.item.create\" \"response.create\" ") {
    fail("unexpected sent event order", final_response);
  }
  // Transcript deltas concatenated, audio chunk surfaced, turn finished.
  if (axllm::stringify(axllm::Core::get(result, "content")) != "\"hello\"") fail("transcript not concatenated", final_response);
  if (axllm::stringify(axllm::Core::get(result, "finish_reason")) != "\"stop\"") fail("turn did not finish", final_response);
  if (axllm::stringify(axllm::Core::get(axllm::Core::get(result, "audio"), "data")) != "\"AQI=\"") {
    fail("audio chunk not surfaced", final_response);
  }
  std::cout << "realtime-audio-turn-ok\n";
  return 0;
}
