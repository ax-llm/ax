package dev.axllm.ax;

/**
 * A TypeScript field processor: {@code process(value, context)} runs on an output field's value.
 *
 * <p>Added with {@link AxFieldProcessorMode#FEEDBACK} it runs on the field's final value, and with
 * {@link AxGen#addStreamingFieldProcessor} on each streamed chunk of a string or code field. A
 * non-empty result is sent to the model as a user message and the forward takes another step,
 * whose answer replaces the earlier one; return {@code null} (or an empty string) to send nothing.
 * An exception the processor throws ends the forward without a retry.
 */
@FunctionalInterface
public interface AxFieldProcessor {
  Object process(Object value, AxFieldProcessorContext context);
}
