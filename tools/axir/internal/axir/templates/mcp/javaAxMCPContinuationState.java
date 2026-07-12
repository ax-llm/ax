package dev.axllm.ax;

import java.util.List;

public record AxMCPContinuationState(
  List<String> namespaces,
  List<Object> tasks,
  List<Object> subscriptions,
  String catalogFingerprint
) {}
