package dev.axllm.ax;

import java.util.List;
import java.util.Map;
import java.util.function.Function;

public final class AxMCPOAuthOptions {
  public String clientId;
  public String clientSecret;
  public String redirectUri;
  public List<String> scopes = List.of();
  public Function<String, Map<String, String>> onAuthCode;
  public TokenStore tokenStore;
  public Map<String, Object> ssrfProtection = Map.of();

  public interface TokenStore {
    AxMCPTokenSet getToken(String key);
    void setToken(String key, AxMCPTokenSet token);
    default void clearToken(String key) {}
  }
}
