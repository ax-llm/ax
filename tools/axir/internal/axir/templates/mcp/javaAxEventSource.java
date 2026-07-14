package dev.axllm.ax;

import java.util.function.Consumer;

public interface AxEventSource { void start(Consumer<AxEventEnvelope> publish); default String identityScope(){return "anonymous";}default String trust(){return "untrusted";}default void close() {} }
