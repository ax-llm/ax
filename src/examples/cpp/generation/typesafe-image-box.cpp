// ax-example:start
// title: Cpp Jev Image Localization
// group: generation
// description: Locates a red square using image inputs and Box outputs with native confidence.
// provider: typesafe
// env: TYPESAFE_APIKEY
// level: intermediate
// order: 47
// ax-example:end
#include "axllm/axllm.hpp"
#include <fstream>
#include <iostream>
#include <iterator>
using namespace axllm;

// Standard-library base64 encoder for inline image data.
static std::string b64encode(const std::string& in) {
  static const char t[] =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string out;
  std::uint32_t val = 0;
  int bits = -6;
  for (unsigned char c : in) {
    val = (val << 8) + c;
    bits += 8;
    while (bits >= 0) {
      out.push_back(t[(val >> bits) & 0x3F]);
      bits -= 6;
    }
  }
  if (bits > -6) out.push_back(t[((val << 8) >> (bits + 8)) & 0x3F]);
  while (out.size() % 4) out.push_back('=');
  return out;
}

int main() {
  const char* key = std::getenv("TYPESAFE_APIKEY");
  if (!key || !*key) throw std::runtime_error("Set TYPESAFE_APIKEY");
  auto model = ai("typesafe", object({{"api_key",key},{"model","jev-1.14.0"}}));
  std::ifstream file("src/examples/assets/decision-shapes.png",std::ios::binary);
  if (!file) throw std::runtime_error("Cannot read decision-shapes.png");
  std::string bytes((std::istreambuf_iterator<char>(file)),std::istreambuf_iterator<char>());
  auto locate = ax("photo:image -> visible:boolean \"Is there a red square in photo?\", target:box(evidence) \"The red square in photo\"");
  auto result = locate.forward(*model, object({{"photo",object({{"mimeType","image/png"},{"data",b64encode(bytes)}})}}));
  // Jev always returns a region; consume it only when the target is present.
  if (Core::truthy(Core::get(result,"visible"))) std::cout << stringify(Core::get(result,"target")) << "\n";
  else std::cout << "The target was not detected.\n";
}
