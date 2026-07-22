package dev.axllm.ax;

public final class AxBalancerOptions {
  public boolean debug = true;
  public int initialBackoffMs = 1000;
  public int maxBackoffMs = 32000;
  public int maxRetries = 3;
  public AxBalancerAdaptiveStrategy strategy;
  public AxBalancerOptions strategy(AxBalancerAdaptiveStrategy value) { this.strategy = value; return this; }
  public AxBalancerOptions debug(boolean value) { this.debug = value; return this; }
  public AxBalancerOptions maxRetries(int value) { this.maxRetries = value; return this; }
}
