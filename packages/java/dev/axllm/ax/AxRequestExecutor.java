package dev.axllm.ax;

@FunctionalInterface
public interface AxRequestExecutor {
  Object execute() throws Exception;
}
