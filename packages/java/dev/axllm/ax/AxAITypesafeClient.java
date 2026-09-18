package dev.axllm.ax;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Native Typesafe API; conversion thresholds apply only to the Ax signature adapter. */
public final class AxAITypesafeClient {
  public sealed interface Answer permits Noul, Choice, Score { Map<String,Object> toMap(); }
  public record Noul(double noul) implements Answer {
    public Map<String,Object> toMap(){return Map.of("type","noul","noul",noul);}
  }
  public record Choice(String choice, Map<String,Double> probabilities, double confidence) implements Answer {
    public Map<String,Object> toMap(){return Map.of("type","choice","choice",choice,"probabilities",probabilities,"confidence",confidence);}
  }
  /** Fractional zero-based position in the caller's rubric. */
  public record Score(double score,Map<String,Double> probabilities,double confidence,Map<String,Object> legend) implements Answer {
    public Map<String,Object> toMap(){return Map.of("type","score","score",score,"probabilities",probabilities,"confidence",confidence,"legend",legend);}
  }
  public record Usage(long inputTokens,long outputTokens) {
    public Map<String,Object> toMap(){return Map.of("input_tokens",inputTokens,"output_tokens",outputTokens);}
  }
  public record Response(String model,Map<String,Answer> answers,Usage usage) {
    public Map<String,Object> toMap(){var values=new LinkedHashMap<String,Object>();answers.forEach((name,answer)->values.put(name,answer.toMap()));return Map.of("model",model,"answers",values,"usage",usage.toMap());}
  }
  public record ModelCard(String name,String description,String releaseDate) {
    public Map<String,Object> toMap(){return Map.of("name",name,"description",description,"release_date",releaseDate);}
  }
  /** Entries may be text, structured objects, arrays, or null. */
  public record Question(String type,Object instructions,Object criteria) {
    public static Question noul(Object instructions,Map<String,Object> criteria){return new Question("noul",instructions,criteria);}
    public static Question choice(Object instructions,Map<String,Object> criteria){return new Question("choice",instructions,criteria);}
    public static Question score(Object instructions,List<Object> criteria){return new Question("score",instructions,criteria);}
    public Map<String,Object> toMap(){var value=new LinkedHashMap<String,Object>();value.put("type",type);value.put("instructions",instructions);if(criteria!=null)value.put("criteria",criteria);return value;}
  }
  public record Request(Object state,Map<String,Question> questions,String model) {
    public Request(Object state,Map<String,Question> questions){this(state,questions,null);}
    public Map<String,Object> toMap(){var value=new LinkedHashMap<String,Object>();value.put("state",state);var entries=new LinkedHashMap<String,Object>();questions.forEach((name,question)->entries.put(name,question.toMap()));value.put("questions",entries);if(model!=null)value.put("model",model);return value;}
  }
  public Response systemOne(Request request)throws Exception{return systemOne(request.toMap());}
  public Response systemOne(Request request,Map<String,Object> options)throws Exception{return systemOne(request.toMap(),options);}
  private static Map<String,Double> probabilities(Object raw){var values=new LinkedHashMap<String,Double>();Core.asMap(raw).forEach((key,value)->values.put(key,((Number)value).doubleValue()));return values;}
  private static Response response(Map<String,Object> raw){
    var answers=new LinkedHashMap<String,Answer>();
    Core.asMap(raw.get("answers")).forEach((name,item)->{
      var value=Core.asMap(item);String type=(String)value.get("type");
      Answer answer=switch(type){
        case "noul"->new Noul(((Number)value.get("noul")).doubleValue());
        case "choice"->new Choice((String)value.get("choice"),probabilities(value.get("probabilities")),((Number)value.get("confidence")).doubleValue());
        case "score"->new Score(((Number)value.get("score")).doubleValue(),probabilities(value.get("probabilities")),((Number)value.get("confidence")).doubleValue(),Core.asMap(value.get("legend")));
        default->throw new IllegalArgumentException("Invalid Typesafe answer type "+type);
      };answers.put(name,answer);
    });
    var usage=Core.asMap(raw.get("usage"));return new Response((String)raw.get("model"),answers,new Usage(((Number)usage.get("input_tokens")).longValue(),((Number)usage.get("output_tokens")).longValue()));
  }

  private final Map<String, Object> options;
  private final String model;

  public AxAITypesafeClient(Map<String, Object> options) {
    this.options = new LinkedHashMap<>(options == null ? Map.of() : options);
    this.model = String.valueOf(this.options.getOrDefault("model", "jev-latest"));
    // Fail missing credentials and invalid configuration at construction.
    new OpenAICompatibleClient("typesafe", "Typesafe", this.options, this.model, "");
  }

  public Response systemOne(Map<String, Object> request) throws Exception {
    return systemOne(request, Map.of());
  }

  public Response systemOne(Map<String, Object> request, Map<String, Object> callOptions) throws Exception {
    Map<String, Object> payload = Core.asMap(Json.parse(Json.stringify(request)));
    payload.putIfAbsent("model", model);
    Core.typesafe_validate_request(payload);
    Object raw = request("POST", "/v1/systemone", "chat", payload, callOptions);
    return response(Core.asMap(Core.typesafe_decode_response(raw, payload.get("questions"))));
  }

  public List<ModelCard> listModels() throws Exception { return listModels(Map.of()); }

  public List<ModelCard> listModels(Map<String, Object> callOptions) throws Exception {
    Object raw = request("GET", "/v1/models", "models", null, callOptions);
    return Core.asList(Core.typesafe_decode_models(raw)).stream().map(Core::asMap).map(value->new ModelCard((String)value.get("name"),(String)value.get("description"),(String)value.get("release_date"))).toList();
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
    var client = new OpenAICompatibleClient("typesafe", "Typesafe", resolved, model, "");
    Map<String, Object> retry = Core.asMap(Core.resolve_stream_retry(resolved));
    int retries = ((Number) retry.get("max_retries")).intValue();
    for (int attempt = 0; ; attempt++) {
      if (cancellation != null) cancellation.throwIfCancelled();
      try {
        return client.requestJson(path, payload, false, "json", false, method, operation, cancellation);
      } catch (AxAIServiceError error) {
        if (!error.retryable || attempt >= retries) throw error;
        double delay = Math.min(((Number) retry.get("initial_delay_ms")).doubleValue() * Math.pow(((Number) retry.get("backoff_factor")).doubleValue(), attempt), ((Number) retry.get("max_delay_ms")).doubleValue());
        long until = System.nanoTime() + (long) (delay * 1_000_000);
        while (System.nanoTime() < until) {
          if (cancellation != null) cancellation.throwIfCancelled();
          Thread.sleep(Math.max(1, Math.min(10, (until - System.nanoTime()) / 1_000_000)));
        }
      }
    }
  }
}
