package dev.axllm.ax;

import java.util.Map;

public interface AxGauge {
  void record(double value, Map<String, Object> attributes);
}
