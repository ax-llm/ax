package dev.axllm.ax;

import java.util.Map;

public interface AxCounter {
  void add(double value, Map<String, Object> attributes);
}
