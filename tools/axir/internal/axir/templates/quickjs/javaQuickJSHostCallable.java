package dev.axllm.ax.runtime.quickjs;

@FunctionalInterface
public interface AxQuickJsHostCallable {
  Object call(Object params) throws Exception;
}
