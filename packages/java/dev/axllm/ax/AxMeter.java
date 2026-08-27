package dev.axllm.ax;

public interface AxMeter {
  AxCounter createCounter(String name, AxMetricInstrumentOptions options);
  AxHistogram createHistogram(String name, AxMetricInstrumentOptions options);
  AxGauge createGauge(String name, AxMetricInstrumentOptions options);
}
