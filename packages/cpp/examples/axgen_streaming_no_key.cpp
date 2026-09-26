#include "axllm/axllm.hpp"
#include <cctype>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

// Streams one scripted answer per request as OpenAI SSE chunks of a few
// characters, the way a provider streams text.
struct ScriptedStream : axllm::Transport {
  std::vector<std::string> answers;
  std::vector<axllm::Value> requests;

  explicit ScriptedStream(std::vector<std::string> scripted) : answers(std::move(scripted)) {}

  axllm::Value call(axllm::Value) override { return axllm::Value::object(); }

  void stream(axllm::Value request, axllm::AxTransportStreamHandler handler) override {
    requests.push_back(request);
    const std::string answer = answers.at(requests.size() - 1);
    for (std::size_t at = 0; at < answer.size(); at += 5) {
      if (!handler(chunk(axllm::object({{"content", answer.substr(at, 5)}}), axllm::Value()))) return;
    }
    if (!handler(chunk(axllm::Value::object(), "stop"))) return;
    handler(std::string("data: [DONE]\n\n"));
  }

  static std::string chunk(axllm::Value delta, axllm::Value finish_reason) {
    axllm::Value choice = axllm::object({{"index", 0}, {"delta", delta}, {"finish_reason", finish_reason}});
    axllm::Value event = axllm::object({{"id", "chatcmpl_story"}, {"model", "gpt-5.4-mini"}, {"choices", axllm::array({choice})}});
    return "data: " + axllm::stringify(event) + "\n\n";
  }

  bool sent(std::size_t index, const std::string& text) const {
    return index < requests.size() && axllm::stringify(requests[index]).find(text) != std::string::npos;
  }
};

struct Interrupted {};

int main() {
  ScriptedStream transport({
      "Title: night watch\nStory: A dragon guards the lighthouse.",
      "Title: night watch\nStory: The cat keeps the lamp lit through every storm while the keeper sleeps.",
      "Title: night watch\nStory: The cat keeps the lamp lit.",
      "Title: cut short\nStory: This run stops early.",
      "Title: cut short\nStory: This handler gives up.",
      "Title: calm sea\nStory: The sea rests under a quiet moon.",
  });
  axllm::OpenAICompatibleClient client(axllm::object({{"api_key", "test-key"}, {"model", "gpt-5.4-mini"}}), &transport);
  auto story = axllm::ax("topic:string -> title:string, story:string");

  // A callable streaming assertion checks the story as it streams; a failure
  // retries the attempt with the message as the correction.
  story.add_streaming_assert("story", [](const std::string& text, bool) -> axllm::Value {
    if (text.find("dragon") == std::string::npos) return true;
    return "Keep dragons out of the story.";
  });
  // A Feedback processor sends its note back to the model for another step,
  // whose answer replaces this one, as TypeScript's addFieldProcessor does.
  story.add_field_processor(
      "story",
      [](const axllm::Value& value, const axllm::AxFieldProcessorContext&) -> axllm::Value {
        std::istringstream words(axllm::display(value));
        int count = 0;
        for (std::string word; words >> word;) ++count;
        if (count <= 8) return nullptr;
        return "Answer again in at most 8 words.";
      },
      axllm::AxFieldProcessorMode::Feedback);
  // A streaming field processor sees the story's text so far as it streams.
  std::vector<std::string> seen;
  bool saw_done = false;
  story.add_streaming_field_processor("story", [&](const axllm::Value& text, const axllm::AxFieldProcessorContext& context) -> axllm::Value {
    seen.push_back(axllm::display(text));
    saw_done = saw_done || context.done;
    return nullptr;
  });
  // A Transform processor rewrites the final title, with the output at hand;
  // streaming holds the title back and sends it once, rewritten.
  bool title_saw_story = false;
  story.add_field_processor(
      "title",
      [&](const axllm::Value& value, const axllm::AxFieldProcessorContext& context) -> axllm::Value {
        title_saw_story = context.done && axllm::Core::get(context.values, "story").is_string();
        std::string title = axllm::display(value);
        bool word_start = true;
        for (char& c : title) {
          if (word_start) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
          word_start = c == ' ';
        }
        return title;
      },
      axllm::AxFieldProcessorMode::Transform);

  // Merge each index's deltas (strings append, other values replace) and
  // start over when the version changes: the assertion's retry and the
  // feedback step each start a new version.
  axllm::Value merged = axllm::Value::object();
  int64_t version = 0;
  axllm::Value output = story.streaming_forward(
      client, axllm::object({{"topic", "a lighthouse keeper's cat"}}), axllm::Value::object(),
      [&](const axllm::AxGenDelta& delta) {
        if (delta.version != version) {
          merged = axllm::Value::object();
          version = delta.version;
        }
        for (const auto& key : axllm::Core::iter(delta.delta)) {
          std::string field = axllm::display(key);
          axllm::Value value = axllm::Core::get(delta.delta, field);
          axllm::Value previous = axllm::Core::get(merged, field);
          bool append = value.is_string() && (previous.is_null() || previous.is_string());
          axllm::Core::set(merged, field, append ? axllm::Value(axllm::display(previous) + axllm::display(value)) : value);
        }
        return true;
      });
  const std::string title = axllm::display(axllm::Core::get(output, "title"));
  const std::string text = axllm::display(axllm::Core::get(output, "story"));
  if (title != "Night Watch" || text != "The cat keeps the lamp lit.") return 1;
  if (axllm::display(axllm::Core::get(merged, "title")) != title || axllm::display(axllm::Core::get(merged, "story")) != text) return 2;
  if (version != 2 || transport.requests.size() != 3) return 3;
  if (!transport.sent(1, "Keep dragons out of the story.") || !transport.sent(2, "Answer again in at most 8 words.")) return 4;
  if (seen.empty() || !saw_done || !title_saw_story) return 5;

  // Returning false stops the run: the stream closes, nothing is thrown, and
  // the result is what was merged so far.
  axllm::Value partial = story.streaming_forward(
      client, axllm::object({{"topic", "a short one"}}), axllm::Value::object(),
      [](const axllm::AxGenDelta&) { return false; });
  const std::string partial_story = axllm::display(axllm::Core::get(partial, "story"));
  if (transport.requests.size() != 4 || partial_story.empty() || std::string("This run stops early.").rfind(partial_story, 0) != 0) return 6;

  // An exception from the handler stops the run and reaches the caller as is.
  try {
    story.streaming_forward(client, axllm::object({{"topic", "a short one"}}), axllm::Value::object(),
                            [](const axllm::AxGenDelta&) -> bool { throw Interrupted{}; });
    return 7;
  } catch (const Interrupted&) {
  }
  if (transport.requests.size() != 5) return 8;

  // A cancelled token stops the run before a request goes out.
  axllm::AxCancellationToken token;
  token.cancel("user left");
  try {
    story.streaming_forward(client, axllm::object({{"topic", "a short one"}}), axllm::Value::object(),
                            [](const axllm::AxGenDelta&) { return true; }, &token);
    return 9;
  } catch (const axllm::AxAIServiceAbortedError&) {
  }
  if (transport.requests.size() != 5) return 10;

  // Under run control the model call streams through the run's response
  // boundary, where queued steering joins the request.
  auto control = axllm::run_control();
  control.steer("Keep it gentle.");
  int steered_deltas = 0;
  axllm::Value calm = story.streaming_forward(
      client, axllm::object({{"topic", "a calm sea"}}), axllm::object({{"control", control.value()}}),
      [&](const axllm::AxGenDelta&) {
        ++steered_deltas;
        return true;
      });
  if (!transport.sent(5, "Keep it gentle.") || steered_deltas < 2) return 11;
  if (axllm::display(axllm::Core::get(calm, "story")) != "The sea rests under a quiet moon.") return 12;
  std::cout << "cpp-axgen-streaming-ok " << title << ": " << text << "\n";
}
