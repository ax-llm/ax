package dev.axllm.ax;

public final class AxAgentClarificationException extends RuntimeException {
  private final Object clarification;
  private final Object state;
  private final Object payload;

  public AxAgentClarificationException(Object clarification, Object state, Object payload) {
    super(String.valueOf(Core.get(clarification, "question", Core.get(clarification, "message", clarification))));
    this.clarification = clarification;
    this.state = state;
    this.payload = payload;
  }

  public Object clarification() { return clarification; }
  public Object state() { return state; }
  public Object payload() { return payload; }
}
