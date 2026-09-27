import dev.axllm.ax.*;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.Callable;
import java.util.concurrent.atomic.AtomicInteger;

// Send requests through the REAL HttpClient transport to in-process loopback
// servers that fail the way networks do, and check that the failures surface
// as TypeScript's apiCall reports fetch's: a refused or dropped connection is
// AxAIServiceNetworkError ("Network Error: ..."), which a stream's request
// layer retries under the call's retry options; a timeout is
// AxAIServiceTimeoutError ("Request timed out after <ms>ms", the client's
// timeout in milliseconds), which the request layer never retries; and AxGen
// retries both as infrastructure errors. Exits non-zero on any mismatch so
// `axir verify` fails if it regresses.
public final class TransportErrorsHTTPRoundtripExample {
  static final String DROP_EVENT = "data: {\"id\":\"chatcmpl_drop\",\"object\":\"chat.completion.chunk\",\"created\":0,\"model\":\"gpt-5.4-mini\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Hel\"},\"finish_reason\":null}]}\n\n";
  static final Map<String, Object> REQUEST = Map.of("chat_prompt", List.of(Map.of("role", "user", "content", "hi")));
  static final Map<String, Object> FAST_RETRY = Map.of("maxRetries", 2, "initialDelayMs", 10, "maxDelayMs", 20);

  public static void main(String[] args) throws Exception {
    // A refused connection.
    int refused = closedPort();
    expect("refused chat", "AxAIServiceNetworkError", "Network Error: ", () -> client(refused, Map.of()).chat(REQUEST, new LinkedHashMap<>(Map.of("stream", false))));
    expect("refused stream", "AxAIServiceNetworkError", "Network Error: ", () -> drain(client(refused, Map.of()), new LinkedHashMap<>(Map.of("retry", FAST_RETRY)), null));

    // A server that closes each connection without a response. The stream's
    // request layer retries it under the call's retry options: the first
    // request and two retries.
    AtomicInteger closed = new AtomicInteger();
    int closing = serve("close", closed);
    expect("closed chat", "AxAIServiceNetworkError", "Network Error: ", () -> client(closing, Map.of()).chat(REQUEST, new LinkedHashMap<>(Map.of("stream", false))));
    int before = closed.get();
    expect("closed stream", "AxAIServiceNetworkError", "Network Error: ", () -> drain(client(closing, Map.of()), new LinkedHashMap<>(Map.of("retry", FAST_RETRY)), null));
    expectCount("closed stream", closed.get() - before, 3);

    // The client's own timeout (seconds) ends a chat or a stream whose
    // response has not started, in TS's words, and the request layer does not
    // retry it.
    AtomicInteger held = new AtomicInteger();
    int silent = serve("hold", held);
    before = held.get();
    expect("timed-out chat", "AxAIServiceTimeoutError", "Request timed out after 300ms", () -> client(silent, Map.of("timeout", 0.3)).chat(REQUEST, new LinkedHashMap<>(Map.of("stream", false))));
    expect("timed-out stream", "AxAIServiceTimeoutError", "Request timed out after 300ms", () -> drain(client(silent, Map.of("timeout", 0.3)), new LinkedHashMap<>(Map.of("retry", FAST_RETRY)), null));
    expectCount("timed-out requests", held.get() - before, 2);

    // A server that sends one event and drops the connection: the stream ends
    // in an infrastructure error after the event, and is not retried.
    AtomicInteger dropped = new AtomicInteger();
    int dropping = serve("drop", dropped);
    int[] delivered = {0};
    expect("dropped stream", "AxAIServiceStreamTerminatedError", "", () -> drain(client(dropping, Map.of()), new LinkedHashMap<>(Map.of("retry", FAST_RETRY)), delivered));
    expectCount("dropped stream events", delivered[0], 1);
    expectCount("dropped stream", dropped.get(), 1);

    // AxGen retries a network error and a timeout as infrastructure errors.
    // The client's own retries are off, so each request is one AxGen attempt:
    // maxRetries 1 is the first attempt and one retry.
    Map<String, Object> noRequestRetry = Map.of("retry", Map.of("maxRetries", 0));
    for (boolean stream : new boolean[] {false, true}) {
      before = closed.get();
      expect("AxGen network (stream " + stream + ")", "AxAIServiceNetworkError", "Network Error: ", () -> Ax.ax("question:string -> answer:string").forward(client(closing, noRequestRetry), Map.of("question", "hi"), new LinkedHashMap<>(Map.of("maxRetries", 1, "stream", stream))));
      expectCount("AxGen network (stream " + stream + ")", closed.get() - before, 2);
      before = held.get();
      expect("AxGen timeout (stream " + stream + ")", "AxAIServiceTimeoutError", "Request timed out after 200ms", () -> Ax.ax("question:string -> answer:string").forward(client(silent, noRequestRetry), Map.of("question", "hi"), new LinkedHashMap<>(Map.of("maxRetries", 1, "stream", stream, "timeoutMs", 200))));
      expectCount("AxGen timeout (stream " + stream + ")", held.get() - before, 2);
    }
    System.out.println("transport-errors-http-roundtrip-ok");
    System.exit(0);
  }

  static OpenAICompatibleClient client(int port, Map<String, Object> options) {
    Map<String, Object> config = new LinkedHashMap<>(Map.of("api_key", "test-key", "base_url", "http://127.0.0.1:" + port, "model", "gpt-5.4-mini"));
    config.putAll(options);
    return new OpenAICompatibleClient(config);
  }

  static Object drain(OpenAICompatibleClient client, Map<String, Object> options, int[] delivered) throws Exception {
    try (AxChatStream stream = client.openStream(REQUEST, options, null)) {
      for (Object ignored : stream) if (delivered != null) delivered[0]++;
    }
    return null;
  }

  // The error, or an error it wraps, must be of the named Ax error type with
  // a message that starts with prefix.
  static void expect(String label, String type, String prefix, Callable<Object> run) {
    try {
      run.call();
    } catch (Throwable error) {
      for (Throwable current = error; current != null; current = current.getCause()) {
        if (type.equals(current.getClass().getSimpleName())) {
          if (!String.valueOf(current.getMessage()).startsWith(prefix)) throw new RuntimeException(label + ": " + current.getMessage() + " does not start with " + prefix, error);
          return;
        }
      }
      throw new RuntimeException(label + ": want " + type + ", got " + error, error);
    }
    throw new RuntimeException(label + ": no error");
  }

  static void expectCount(String label, int got, int want) {
    if (got != want) throw new RuntimeException(label + ": " + got + " requests, want " + want);
  }

  // A loopback port nothing listens on.
  static int closedPort() throws Exception {
    try (ServerSocket probe = new ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))) {
      return probe.getLocalPort();
    }
  }

  // Read the request headers and its Content-Length body.
  static void readRequest(Socket socket) throws Exception {
    java.io.InputStream in = socket.getInputStream();
    java.io.ByteArrayOutputStream head = new java.io.ByteArrayOutputStream();
    int matched = 0;
    while (matched < 4) {
      int next = in.read();
      if (next < 0) return;
      head.write(next);
      matched = next == "\r\n\r\n".charAt(matched) ? matched + 1 : next == '\r' ? 1 : 0;
    }
    int length = 0;
    for (String line : head.toString(StandardCharsets.ISO_8859_1).split("\r\n")) {
      int colon = line.indexOf(':');
      if (colon > 0 && line.substring(0, colon).trim().equalsIgnoreCase("content-length")) length = Integer.parseInt(line.substring(colon + 1).trim());
    }
    in.readNBytes(length);
  }

  // Accept connections and count them: "close" closes each one without a
  // response, "drop" sends one stream event and drops it, "hold" never answers.
  static int serve(String mode, AtomicInteger connections) throws Exception {
    ServerSocket listener = new ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"));
    List<Socket> held = Collections.synchronizedList(new ArrayList<>());
    Thread thread = new Thread(() -> {
      while (true) {
        try {
          Socket socket = listener.accept();
          connections.incrementAndGet();
          if ("hold".equals(mode)) {
            held.add(socket);
            continue;
          }
          readRequest(socket);
          if ("drop".equals(mode)) {
            String response = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n"
                + Integer.toHexString(DROP_EVENT.length()) + "\r\n" + DROP_EVENT + "\r\n";
            socket.getOutputStream().write(response.getBytes(StandardCharsets.UTF_8));
            socket.getOutputStream().flush();
            Thread.sleep(50);
          }
          socket.close();
        } catch (Exception error) {
          return;
        }
      }
    });
    thread.setDaemon(true);
    thread.start();
    return listener.getLocalPort();
  }
}
