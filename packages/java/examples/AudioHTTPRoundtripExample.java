import com.sun.net.httpserver.HttpServer;
import dev.axllm.ax.*;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.AtomicBoolean;

// Drive transcribe()/speak() through the REAL HttpClient transport against an
// in-process com.sun.net.httpserver loopback, exercising the wire-level encoders
// the conformance ScriptedTransport bypasses: the multipart/form-data request
// body (transcribe) and binary (non-UTF8) response handling (speak). Exits
// non-zero on any mismatch so `axir verify` fails if either regresses.
public final class AudioHTTPRoundtripExample {
  public static void main(String[] args) throws Exception {
    // Deliberately non-UTF8 bytes so a UTF-8/JSON decode regression corrupts them.
    byte[] audioBytes = {0, 1, 2, (byte) 0xff, (byte) 0xfe, 16, 127};
    String audioB64 = Base64.getEncoder().encodeToString(audioBytes);
    byte[] speechBytes = {(byte) 0xff, (byte) 0xd8, (byte) 0xff, 0, 17, 34, (byte) 0xfe};
    String wantAudio = Base64.getEncoder().encodeToString(speechBytes);

    AtomicBoolean sawMultipart = new AtomicBoolean(false);
    AtomicBoolean fileBytesPresent = new AtomicBoolean(false);

    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext(
        "/",
        exchange -> {
          String path = exchange.getRequestURI().getPath();
          byte[] body = exchange.getRequestBody().readAllBytes();
          if (path.contains("transcriptions")) {
            String contentType = exchange.getRequestHeaders().getFirst("Content-Type");
            sawMultipart.set(
                contentType != null && contentType.startsWith("multipart/form-data; boundary="));
            fileBytesPresent.set(containsBytes(body, audioBytes));
            byte[] resp =
                "{\"text\":\"hello world\",\"language\":\"en\",\"duration\":1.25}"
                    .getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, resp.length);
            try (OutputStream os = exchange.getResponseBody()) {
              os.write(resp);
            }
          } else if (path.contains("speech")) {
            exchange.getResponseHeaders().set("Content-Type", "audio/mpeg");
            exchange.sendResponseHeaders(200, speechBytes.length);
            try (OutputStream os = exchange.getResponseBody()) {
              os.write(speechBytes);
            }
          } else {
            exchange.sendResponseHeaders(404, -1);
            exchange.close();
          }
        });
    server.start();
    int port = server.getAddress().getPort();

    try {
      OpenAIResponsesClient client =
          new OpenAIResponsesClient(
              Map.of("api_key", "test-key", "base_url", "http://127.0.0.1:" + port));
      Map<String, Object> transcript =
          client.transcribe(
              Map.of(
                  "audio", audioB64, "language", "en", "model", "gpt-4o-mini-transcribe", "format",
                  "json"));
      if (!sawMultipart.get())
        throw new RuntimeException("loopback server never received a multipart transcribe request");
      if (!fileBytesPresent.get())
        throw new RuntimeException("multipart body did not contain the decoded file bytes");
      if (!"hello world".equals(transcript.get("text")))
        throw new RuntimeException("transcribe response not normalized: " + transcript);

      Map<String, Object> speech =
          client.speak(
              Map.of("text", "hello", "voice", "alloy", "format", "mp3", "model", "gpt-4o-mini-tts"));
      if (!wantAudio.equals(speech.get("audio")))
        throw new RuntimeException("speak binary response not base64-encoded as expected: " + speech);
    } finally {
      server.stop(0);
    }
    System.out.println("audio-http-roundtrip-ok");
  }

  private static boolean containsBytes(byte[] haystack, byte[] needle) {
    if (needle.length == 0) return true;
    outer:
    for (int i = 0; i + needle.length <= haystack.length; i++) {
      for (int j = 0; j < needle.length; j++) {
        if (haystack[i + j] != needle[j]) continue outer;
      }
      return true;
    }
    return false;
  }
}
