package dev.axllm.ax;

public final class AxMCPTokenSet {
  public final String accessToken;
  public final String refreshToken;
  public final Long expiresAt;
  public final String issuer;

  public AxMCPTokenSet(String accessToken) {
    this(accessToken, null, null, null);
  }

  public AxMCPTokenSet(String accessToken, String refreshToken, Long expiresAt, String issuer) {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    this.expiresAt = expiresAt;
    this.issuer = issuer;
  }
}
