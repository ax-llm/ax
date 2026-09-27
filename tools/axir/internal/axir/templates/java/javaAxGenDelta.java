package dev.axllm.ax;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * One update of {@link AxGen#streamingForward}, as TypeScript's streamingForward yields it. Merge
 * {@code delta} into the sample at {@code index} (strings and lists append, other values replace),
 * and start that sample over when {@code version} changes: a validation or refusal retry, or a
 * step that replaces output an earlier step sent, starts a new version.
 *
 * @param version the attempt the delta belongs to; a new version replaces what was merged before
 * @param index the sample index (0 unless the forward asks for several samples)
 * @param delta the new part of each output field that changed, in field order
 */
public record AxGenDelta(int version, int index, Map<String, Object> delta) {
  public AxGenDelta {
    delta = delta == null ? Map.of() : Collections.unmodifiableMap(new LinkedHashMap<>(delta));
  }

  static AxGenDelta fromEnvelope(Object envelope) {
    Map<String, Object> map = Core.asMap(envelope);
    return new AxGenDelta(
        Core.asInt(map.getOrDefault("version", 0)),
        Core.asInt(map.getOrDefault("index", 0)),
        Core.asMap(Core.ownedCopy(map.get("delta"))));
  }
}
