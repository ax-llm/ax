package dev.axllm.ax;
import java.util.LinkedHashMap;
import java.util.Map;

/** Native Gemini Decisions named questions, answers, distributions and full usage. */
public final class AxAIGoogleGeminiDecisionsClient {
  private final Map<String,Object> options;
  private final String model;
  public AxAIGoogleGeminiDecisionsClient(Map<String,Object> options) {
    this.options = new LinkedHashMap<>(options == null ? Map.of() : options);
    this.model = String.valueOf(this.options.getOrDefault("model", "gemini-decision-1"));
    new OpenAICompatibleClient("google-gemini-decisions", "Google Gemini Decisions", this.options, model, "");
  }
  public Map<String,Object> create(Map<String,Object> request) throws Exception { return create(request, Map.of()); }
  public Map<String,Object> create(Map<String,Object> request, Map<String,Object> callOptions) throws Exception {
    var payload = Core.asMap(Json.parse(Json.stringify(request)));
    payload.putIfAbsent("model", model);
    Core.google_decisions_validate_request(payload);
    var raw = request("POST", "/decisions", "chat", payload, callOptions);
    return Core.asMap(Core.google_decisions_decode_response(raw, payload.get("questions")));
  }
  private Object request(String method, String path, String operation, Map<String, Object> payload, Map<String, Object> callOptions) throws Exception {
    Map<String, Object> resolved = new LinkedHashMap<>(options);
    if (callOptions != null) resolved.putAll(callOptions);
    var inherited = AxBaseAI.cancellation(options);
    var perCall = AxBaseAI.cancellation(callOptions);
    boolean merge = inherited != null && perCall != null && inherited != perCall;
    var cancellation = merge ? new AxCancellationToken() : inherited != null ? inherited : perCall;
    var subscriptions = new java.util.ArrayList<AxCancellationToken.Subscription>();
    try {
      if (merge) {
        subscriptions.add(inherited.subscribe(() -> cancellation.cancel(inherited.reason())));
        subscriptions.add(perCall.subscribe(() -> cancellation.cancel(perCall.reason())));
      }
      if (cancellation != null) cancellation.throwIfCancelled();
      return requestWithCancellation(method, path, operation, payload, resolved, cancellation);
    } finally {
      for (var subscription : subscriptions) subscription.close();
    }
  }

  private Object requestWithCancellation(String method, String path, String operation, Map<String, Object> payload, Map<String, Object> resolved, AxCancellationToken cancellation) throws Exception {
    var client = new OpenAICompatibleClient("google-gemini-decisions", "Google Gemini Decisions", resolved, model, "");
    if (cancellation != null) cancellation.throwIfCancelled();
    // TS apiCall's request-layer retry, as the client's chat requests use.
    return client.requestJsonRetried(path, payload, method, operation, cancellation, resolved);
  }
}
