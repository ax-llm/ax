package dev.axllm.ax;

public record AxMetricInstrumentOptions(String description, String unit) {
  public static AxMetricInstrumentOptions empty() {
    return new AxMetricInstrumentOptions(null, null);
  }
}
