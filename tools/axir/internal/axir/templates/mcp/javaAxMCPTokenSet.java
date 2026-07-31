package dev.axllm.ax;

public final class AxMCPTokenSet {
  public final String accessToken;
  public final String refreshToken;
  public final Long expiresAt;
  public final String issuer;
  public final String tokenType;
  public final String scope;

  public AxMCPTokenSet(String accessToken) {
    this(accessToken, null, null, null, "Bearer", null);
  }

  public AxMCPTokenSet(String accessToken, String refreshToken, Long expiresAt, String issuer) {
    this(accessToken, refreshToken, expiresAt, issuer, "Bearer", null);
  }

  public AxMCPTokenSet(String accessToken, String refreshToken, Long expiresAt, String issuer, String tokenType, String scope) {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    this.expiresAt = expiresAt;
    this.issuer = issuer;
    this.tokenType = tokenType;
    this.scope = scope;
  }
}
