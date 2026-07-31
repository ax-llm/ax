import dev.axllm.ax.*;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class GeneratedMcpOAuthSmoke {
  private static final Pattern JSON_STRING = Pattern.compile("\\\"(code|state|iss)\\\"\\s*:\\s*\\\"([^\\\"]*)\\\"");

  public static void main(String[] args) throws Exception {
    String endpoint = Objects.requireNonNull(System.getenv("AX_MCP_ENDPOINT"));
    String expectedError = Objects.requireNonNullElse(System.getenv("AX_MCP_EXPECT_ERROR"), "");
    Map<String,Object> protection = Map.of("requireHttps", false, "allowLocalhost", true, "allowPrivateNetworks", true);
    AxMCPOAuthOptions oauth = new AxMCPOAuthOptions();
    oauth.clientId = "ax-port-client";
    oauth.redirectUri = "http://localhost:8787/callback";
    oauth.scopes = List.of("mcp:read");
    oauth.requireIss = true;
    oauth.ssrfProtection = protection;
    oauth.tokenStore = new MemoryTokenStore();
    oauth.onAuthCode = GeneratedMcpOAuthSmoke::authorize;
    AxMCPStreamableHTTPTransport transport = new AxMCPStreamableHTTPTransport(endpoint, Map.of("ssrfProtection", protection, "oauth", oauth));
    try {
      transport.send(Map.of("jsonrpc", "2.0", "id", 1, "method", "initialize", "params", Map.of()));
      transport.send(Map.of("jsonrpc", "2.0", "id", 2, "method", "tools/list", "params", Map.of()));
      if (!expectedError.isEmpty()) throw new IllegalStateException("expected " + expectedError + " error");
      System.out.println("AX_MCP_OAUTH_OK");
    } catch (RuntimeException error) {
      if (!expectedError.isEmpty() && error.getMessage().toLowerCase().contains(expectedError.toLowerCase())) {
        System.out.println("AX_MCP_OAUTH_EXPECTED_ERROR");
      } else throw error;
    }
  }

  private static Map<String,String> authorize(String url) {
    try {
      String body = HttpClient.newHttpClient().send(HttpRequest.newBuilder(URI.create(url)).GET().build(), HttpResponse.BodyHandlers.ofString()).body();
      Map<String,String> result = new HashMap<>();
      Matcher matcher = JSON_STRING.matcher(body);
      while (matcher.find()) result.put(matcher.group(1), matcher.group(2));
      return result;
    } catch (Exception error) { throw new RuntimeException(error); }
  }

  private static final class MemoryTokenStore implements AxMCPOAuthOptions.TokenStore {
    private final Map<String,AxMCPTokenSet> values = new HashMap<>();
    public AxMCPTokenSet getToken(String key) { return values.get(key); }
    public void setToken(String key, AxMCPTokenSet token) { values.put(key, token); }
    public void clearToken(String key) { values.remove(key); }
  }
}
