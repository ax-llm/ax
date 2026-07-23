package dev.axllm.ax;

@FunctionalInterface
public interface AxUsageObserver extends java.util.function.Consumer<AxUsageEvent> {
  void observe(AxUsageEvent event);

  @Override
  default void accept(AxUsageEvent event) {
    observe(event);
  }
}
