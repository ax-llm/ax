package dev.axllm.ax;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

public record AxBalancerRoutingEvent(Map<String, Object> value) {
  public AxBalancerRoutingEvent { value = Collections.unmodifiableMap(new LinkedHashMap<>(value)); }
  public String type() { return String.valueOf(value.get("type")); }
}
