package dev.axllm.ax;

public record AxEventCommand(String routeId,String action,String targetId,String instanceKey,String idempotencyKey) {}
