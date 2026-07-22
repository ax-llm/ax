package dev.axllm.ax;

public record AxBalancerCandidateScore(String routeKey, String serviceName, double score, double estimatedCost, double failureProbability, double deadlineMissProbability) {}
