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
  auto client = std::dynamic_pointer_cast<axllm::OpenAICompatibleClient>(axllm::ai("grok", axllm::object({
      {"model", "grok-voice-think-fast-1.0"},
      {"api_key", "test-key"},
  })));
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
  axllm::Value final_response = client->realtime_chat(request, &transport);

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
  auto meta = std::dynamic_pointer_cast<axllm::OpenAICompatibleClient>(axllm::ai("meta", axllm::parse_json(R"({"model":"muse-voice-transcribe-1.0","api_key":"test-key"})")));
  auto meta_request = axllm::parse_json(R"({"model":"muse-voice-transcribe-1.0","chat_prompt":[{"role":"user","content":[{"type":"audio","data":"AAE=","format":"pcm16"}]}],"audio":{"input":{"sampleRate":16000,"channels":1}},"model_config":{"realtimeTranscription":{"partialMode":"delta"}}})");
  std::vector<axllm::Value> meta_inbound = {
    axllm::parse_json(R"({"sessionId":"meta-session"})"),
    axllm::parse_json(R"({"type":"speechStart","turnId":"one"})"),
    axllm::parse_json(R"({"type":"transcript","transcript":"Hello"})"),
    axllm::parse_json(R"({"type":"transcript","transcript":" world"})"),
    axllm::parse_json(R"({"type":"speaker","speaker":"A"})"),
    axllm::parse_json(R"({"type":"speechStart","turnId":"two"})"),
    axllm::parse_json(R"({"type":"transcript","transcript":"Second"})"),
    axllm::parse_json(R"({"type":"speechComplete","turnId":"one","transcript":"Hello world!"})"),
    axllm::parse_json(R"({"type":"speechComplete","turnId":"two","transcript":"Second turn"})"),
  };
  axllm::ScriptedRealtimeTransport meta_transport(meta_inbound);
  auto meta_final = meta->realtime_chat(meta_request, &meta_transport);
  auto meta_results = axllm::Core::iter(axllm::Core::get(meta_final, "results"));
  if (axllm::stringify(axllm::Core::get(meta_final, "remote_session_id")) != "\"meta-session\"" || meta_results.size() != 2 || axllm::stringify(axllm::Core::get(meta_results[0], "content")) != "\"Hello world!\"" || axllm::stringify(axllm::Core::get(meta_results[1], "content")) != "\"Second turn\"") fail("Meta overlapping turns or session lost", meta_final);
  if (meta_transport.sent.size() != 3) fail("Meta setup/audio/shutdown order", meta_final);
  class DuplexProbe : public axllm::RealtimeTransport {
   public:
    std::mutex mutex;
    std::condition_variable ready;
    std::vector<axllm::Value> frames;
    bool ended = false;
    int chunks = 0;
    void send(const axllm::Value& event) override {
      std::lock_guard<std::mutex> lock(mutex);
      auto type = axllm::stringify(axllm::Core::get(event, "type"));
      if (!axllm::Core::get(event, "authorization").is_null()) frames.push_back(axllm::object({{"sessionId", "duplex"}}));
      else if (type == "\"binary\"" && ++chunks == 1) frames.push_back(axllm::object({{"type", "transcript"}, {"transcript", "wrong hypothesis"}}));
      else if (type == "\"endStream\"") { ended = true; frames.push_back(axllm::object({{"type", "transcript"}, {"transcript", "Correct final."}, {"final", true}})); frames.push_back(axllm::Value()); }
      ready.notify_all();
    }
    bool recv(axllm::Value& event) override {
      std::unique_lock<std::mutex> lock(mutex);
      if (!ready.wait_for(lock, std::chrono::seconds(3), [&] { return !frames.empty(); })) throw std::runtime_error("duplex receiver timed out");
      event = frames.front(); frames.erase(frames.begin());
      if (axllm::stringify(axllm::Core::get(event, "transcript")) == "\"wrong hypothesis\"" && ended) throw std::runtime_error("partial delayed until endStream");
      return !event.is_null();
    }
    void close() override { std::lock_guard<std::mutex> lock(mutex); frames.push_back(axllm::Value()); ready.notify_all(); }
  } duplex;
  auto duplex_request = axllm::parse_json(R"({"model":"muse-voice-transcribe-1.0","chat_prompt":[{"role":"user","content":[{"type":"audio","data":"","format":"pcm16"}]}],"audio":{"input":{"sampleRate":16000,"channels":1}}})");
  axllm::Core::set(duplex_request, "chat_prompt", axllm::array({axllm::object({{"role", "user"}, {"content", axllm::array({axllm::object({{"type", "audio"}, {"format", "pcm16"}, {"data", std::string(12800, 'A')}})})}})}));
  auto duplex_final = meta->realtime_chat(duplex_request, &duplex);
  if (axllm::stringify(axllm::Core::get(axllm::Core::iter(axllm::Core::get(duplex_final, "results"))[0], "content")) != "\"Correct final.\"") fail("duplex final lost", duplex_final);
  axllm::AxMemory memory;
  memory.update_result(axllm::parse_json(R"({"thought_blocks":[{"id":"r","data":"Plan"}],"images":[{"id":"image","data":"partial"}]})"));
  memory.update_result(axllm::parse_json(R"({"thought_blocks":[{"id":"r","data":"Plan.","summary":"Plan.","encrypted_content":"opaque"}]})"));
  auto replay = axllm::stringify(memory.history());
  if (replay.find("opaque") == std::string::npos || replay.find("image") == std::string::npos || replay.find("PlanPlan") != std::string::npos) fail("replay metadata lost", replay);
  std::cout << "realtime-audio-turn-ok\n";
  return 0;
}
