package dev.axllm.ax;

import java.util.Map;

public record AxSpanStart(
    String name,
    String kind,
    Map<String, Object> attributes,
    AxSpan parent) {}
