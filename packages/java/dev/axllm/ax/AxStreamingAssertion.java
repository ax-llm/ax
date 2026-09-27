package dev.axllm.ax;

/**
 * Checks an output field's text as it streams, as TypeScript streaming assertions do
 * ({@link AxGen#addStreamingAssert(String, AxStreamingAssertion, String)}).
 *
 * <p>{@code check(text, done)} gets the field's text so far and whether it is final. Return
 * {@code null} or {@code true} to pass; return {@code false} or a message string to fail, which
 * stops the attempt and retries it with a correction (the returned message, else the message
 * given with the assertion). An exception the check throws ends the forward without a retry.
 */
@FunctionalInterface
public interface AxStreamingAssertion {
  Object check(String text, boolean done);
}
