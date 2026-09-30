package dev.axllm.ax;

/** A failed generation with its original failure preserved as the cause. */
public final class AxGenerateError extends RuntimeException {
  public AxGenerateError(String message, Throwable cause) { super(message, cause); }
}
