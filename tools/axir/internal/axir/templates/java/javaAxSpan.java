package dev.axllm.ax;

import java.util.Map;

public interface AxSpan {
  void setAttributes(Map<String, Object> attributes);
  void addEvent(String name, Map<String, Object> attributes);
  void recordException(Throwable error);
  void setStatus(String status, String description);
  void end();
}
