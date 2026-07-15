package dev.axllm.ax;

import java.util.Map;

public interface AxUCPBinding {
  Map<String, Object> call(String operation, Map<String, Object> payload, Map<String, Object> options);
}
