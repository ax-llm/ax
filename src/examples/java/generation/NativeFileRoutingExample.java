// ax-example:start
// title: Java Native File Routing
// group: generation
// description: Summarizes a PDF through a provider router without replacing the native file with extracted text.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY, AX_PDF_BASE64
// level: intermediate
// order: 53
// ax-example:end
import dev.axllm.ax.*;
import java.util.*;
public final class NativeFileRoutingExample {
 public static void main(String[] args) throws Exception {
  String key=System.getenv("OPENAI_API_KEY");if(key==null||key.isBlank())key=System.getenv("OPENAI_APIKEY");
  var client=Ax.ai("openai",Map.of("api_key",Objects.requireNonNull(key,"Set OPENAI_API_KEY or OPENAI_APIKEY"),"model","gpt-6-astra","model_config",Map.of("thinkingTokenBudget","low")));
  var router=new AxProviderRouter(Map.of("providers",Map.of("primary",client)));
  var program=Ax.ax("document:file -> summary:string");
  var result=program.forward(router,Map.of("document",Map.of("filename","report.pdf","mimeType","application/pdf","data",Objects.requireNonNull(System.getenv("AX_PDF_BASE64"),"Set AX_PDF_BASE64"))),Map.of("serviceTier","standard"));
  System.out.println(Json.stringify(result));
 }
}
