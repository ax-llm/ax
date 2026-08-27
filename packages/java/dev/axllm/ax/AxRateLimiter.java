package dev.axllm.ax;

@FunctionalInterface
public interface AxRateLimiter {
  Object run(AxRequestExecutor next, AxRateLimitInfo info) throws Exception;
}
