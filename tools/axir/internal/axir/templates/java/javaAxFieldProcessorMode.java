package dev.axllm.ax;

/** How {@link AxGen#addFieldProcessor(String, AxFieldProcessor, AxFieldProcessorMode)} uses a processor's result. */
public enum AxFieldProcessorMode {
  /**
   * Rewrites the field's final value with the returned value, as {@link AxGen#addFieldTransform}
   * does. This is a port extension.
   */
  TRANSFORM,
  /**
   * TypeScript semantics: a non-empty result goes back to the model as a user message for another
   * step, whose answer replaces the earlier one. This becomes the behavior of the two-argument
   * {@code addFieldProcessor} in the next major version.
   */
  FEEDBACK
}
