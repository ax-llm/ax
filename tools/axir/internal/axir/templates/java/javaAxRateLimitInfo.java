package dev.axllm.ax;

import java.util.Map;

public record AxRateLimitInfo(
    String operation,
    String provider,
    String model,
    boolean streaming,
    Map<String, Object> previousModelUsage) {}
