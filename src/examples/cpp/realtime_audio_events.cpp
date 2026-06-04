#include "axllm/axllm.hpp"

#include <iostream>

int main() {
  axllm::GrokClient grok(axllm::object({
      {"model", "grok-voice-think-fast-1.0"},
      {"api_key", "test-key"},
  }));
  axllm::Value grok_request = axllm::object({
      {"model", "grok-voice-think-fast-1.0"},
      {"chat_prompt",
       axllm::array({
           axllm::object({{"role", "system"}, {"content", "You are a concise voice agent."}}),
           axllm::object({{"role", "user"}, {"content", "Say hello."}}),
       })},
      {"audio",
       axllm::object({
           {"input", axllm::object({{"sampleRate", 24000}})},
           {"output", axllm::object({{"sampleRate", 24000}, {"voice", "eve"}})},
       })},
  });
  axllm::Value grok_events = axllm::array({
      axllm::object({{"type", "response.output_audio_transcript.delta"}, {"response_id", "grok_rt"}, {"delta", "hello "}}),
      axllm::object({{"type", "response.output_audio.delta"}, {"response_id", "grok_rt"}, {"delta", "AQI="}}),
      axllm::object({
          {"type", "response.done"},
          {"response",
           axllm::object({
               {"id", "grok_rt"},
               {"usage", axllm::object({{"input_tokens", 3}, {"output_tokens", 2}, {"total_tokens", 5}})},
           })},
      }),
  });

  axllm::GoogleGeminiClient gemini(axllm::object({
      {"model", "gemini-2.5-flash-native-audio-preview-12-2025"},
      {"api_key", "test-key"},
  }));
  axllm::Value gemini_request = axllm::object({
      {"model", "gemini-2.5-flash-native-audio-preview-12-2025"},
      {"chat_prompt",
       axllm::array({
           axllm::object({{"role", "system"}, {"content", "Answer with audio."}}),
           axllm::object({
               {"role", "user"},
               {"content",
                axllm::array({
                    axllm::object({{"type", "text"}, {"text", "Live question"}}),
                    axllm::object({{"type", "audio"}, {"data", "AAAA"}, {"format", "pcm16"}, {"sampleRate", 16000}}),
                })},
           }),
       })},
      {"audio", axllm::object({{"output", axllm::object({{"transcript", true}, {"voice", "Kore"}})}})},
  });
  axllm::Value gemini_audio_part = axllm::object({
      {"inlineData", axllm::object({{"data", "AQI="}, {"mimeType", "audio/pcm"}})},
  });
  axllm::Value gemini_turn_event = axllm::object({
      {"id", "gemini_live_2"},
      {"serverContent",
       axllm::object({
           {"modelTurn", axllm::object({{"parts", axllm::array({gemini_audio_part})}})},
       })},
  });
  axllm::Value gemini_tool_event = axllm::object({
      {"id", "gemini_live_3"},
      {"toolCall",
       axllm::object({
           {"functionCalls",
            axllm::array({axllm::object({{"name", "lookup"}, {"args", axllm::object({{"q", "ax"}})}})})},
       })},
  });
  axllm::Value gemini_events = axllm::array({
      axllm::object({{"id", "gemini_live_1"}, {"serverContent", axllm::object({{"outputTranscription", axllm::object({{"text", "spoken "}})}})}}),
      gemini_turn_event,
      gemini_tool_event,
      axllm::object({
          {"id", "gemini_live_done"},
          {"serverContent", axllm::object({{"turnComplete", true}})},
          {"usageMetadata", axllm::object({{"promptTokenCount", 3}, {"candidatesTokenCount", 4}, {"totalTokenCount", 7}})},
      }),
  });

  std::cout << "grok setup:\n" << axllm::stringify(grok.realtime_audio_setup(grok_request)) << "\n";
  std::cout << "grok normalized events:\n" << axllm::stringify(axllm::Value(grok.realtime(grok_events))) << "\n";
  std::cout << "gemini setup:\n" << axllm::stringify(gemini.realtime_audio_setup(gemini_request)) << "\n";
  std::cout << "gemini input messages:\n" << axllm::stringify(gemini.realtime_audio_input(gemini_request)) << "\n";
  std::cout << "gemini normalized events:\n" << axllm::stringify(axllm::Value(gemini.realtime(gemini_events))) << "\n";
}
