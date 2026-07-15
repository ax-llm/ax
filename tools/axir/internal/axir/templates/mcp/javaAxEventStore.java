package dev.axllm.ax;

import java.util.List;

public interface AxEventStore { void enqueue(AxEventEnvelope event, List<AxEventCommand> commands); }
