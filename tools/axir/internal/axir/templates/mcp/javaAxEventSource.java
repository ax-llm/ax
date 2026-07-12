package dev.axllm.ax;

import java.util.function.Consumer;

public interface AxEventSource { void start(Consumer<AxEventEnvelope> publish); }
