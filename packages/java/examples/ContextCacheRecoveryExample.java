import dev.axllm.ax.GoogleGeminiClient;
import dev.axllm.ax.OpenAICompatibleClient;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class ContextCacheRecoveryExample {
  static Object success(String text) { return Map.of("status",200,"json",Map.of("candidates",List.of(Map.of("content",Map.of("parts",List.of(Map.of("text",text))),"finishReason","STOP")))); }
  static Object cache(String name,long seconds) { return Map.of("status",200,"json",Map.of("name",name,"expireTime",System.currentTimeMillis()+seconds*1000)); }
  static Object failure(int status,String message) { return Map.of("status",status,"json",Map.of("error",Map.of("message",message))); }
  static final class Script implements OpenAICompatibleClient.Transport {
    final ArrayDeque<Object> responses; final List<Map<String,Object>> requests=new ArrayList<>();
    Script(Object... responses){this.responses=new ArrayDeque<>(List.of(responses));}
    public Object call(Map<String,Object> request){requests.add(new LinkedHashMap<>(request));return responses.removeFirst();}
    List<String> methods(){return requests.stream().map(value->String.valueOf(value.get("method"))).toList();}
  }
  static GoogleGeminiClient service(Script script){return new GoogleGeminiClient(Map.of("model","gemini-3.5-flash","api_key","gemini-key","transport",script,"contextCache",Map.of("minTokens",0,"ttlSeconds",3600,"refreshWindowSeconds",300)));}
  public static void main(String[] args) throws Exception {
    Map<String,Object> request=Map.of("chat_prompt",List.of(Map.of("role","system","content","stable context"),Map.of("role","user","content","answer briefly")));
    Script recovery=new Script(cache("cachedContents/cache-1",3600),failure(400,"cachedContent is invalid"),success("uncached recovery")); service(recovery).chat(request); if(!recovery.methods().equals(List.of("POST","POST","POST")))throw new AssertionError(recovery.methods());
    Script refresh=new Script(cache("cachedContents/old",1),success("old"),failure(500,"refresh failed"),cache("cachedContents/new",3600),success("recreated")); GoogleGeminiClient refreshClient=service(refresh);refreshClient.chat(request);refreshClient.chat(request);if(!refresh.methods().equals(List.of("POST","POST","PATCH","POST","POST")))throw new AssertionError(refresh.methods());
    Script fallback=new Script(cache("cachedContents/old",1),success("old"),failure(500,"refresh failed"),failure(500,"recreate failed"),success("uncached fallback"));GoogleGeminiClient fallbackClient=service(fallback);fallbackClient.chat(request);fallbackClient.chat(request);if(!fallback.methods().equals(List.of("POST","POST","PATCH","POST","POST")))throw new AssertionError(fallback.methods());
    System.out.println("java-context-cache-recovery-ok");
  }
}
