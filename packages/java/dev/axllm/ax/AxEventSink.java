package dev.axllm.ax;

import java.util.Map;

public interface AxEventSink { void write(Object output, Map<String,Object> context); }
