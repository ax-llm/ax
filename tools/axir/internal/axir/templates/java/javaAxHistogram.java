package dev.axllm.ax;

import java.util.Map;

public interface AxHistogram {
  void record(double value, Map<String, Object> attributes);
}
