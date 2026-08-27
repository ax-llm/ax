package dev.axllm.ax;

@FunctionalInterface
public interface AxTracer {
  AxSpan startSpan(AxSpanStart start);
}
