package dev.axllm.ax;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public record AxUsageEvent(Map<String, Object> value) {
  public AxUsageEvent {
    value = freezeMap(value);
  }

  public String operation() { return String.valueOf(value.get("operation")); }

  private static Map<String, Object> freezeMap(Map<String, Object> source) {
    Map<String, Object> out = new LinkedHashMap<>();
    if (source != null) {
      for (Map.Entry<String, Object> entry : source.entrySet()) {
        out.put(entry.getKey(), freeze(entry.getValue()));
      }
    }
    return Collections.unmodifiableMap(out);
  }

  private static Object freeze(Object value) {
    if (value instanceof Map<?, ?> map) return freezeMap(Core.asMap(map));
    if (value instanceof List<?> list) {
      List<Object> out = new ArrayList<>();
      for (Object item : list) out.add(freeze(item));
      return Collections.unmodifiableList(out);
    }
    return value;
  }
}
