package dev.axllm.ax;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * What an {@link AxFieldProcessor} gets besides the value.
 *
 * @param values the output values parsed so far (read-only)
 * @param done whether the value is final; a streaming processor also sees each partial value
 */
public record AxFieldProcessorContext(Map<String, Object> values, boolean done) {
  public AxFieldProcessorContext {
    values = values == null ? Map.of() : Collections.unmodifiableMap(new LinkedHashMap<>(values));
  }
}
