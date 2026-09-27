package dev.axllm.ax;

import java.util.Map;

/**
 * A TypeScript AxGen {@code cachingFunction}: {@code apply(key, null)} reads the output stored
 * under {@code key}, or returns {@code null} for a miss, and {@code apply(key, output)} stores one
 * (its return value is ignored).
 *
 * <p>Pass it under the {@code cachingFunction} option of the {@link AxGen} constructor or of a
 * forward call, or set it for the process with {@link AxGlobals#setCachingFunction}; the call's
 * function comes first, then the constructor's, then the process-wide one. {@link AxGen#forward}
 * returns a stored output without a request and stores each output it returns; an exception a
 * read throws propagates and one a store throws is ignored. {@link AxGen#streamingForward} yields
 * a stored output as one delta ({@code version} 0, {@code index} 0), ignores an exception a read
 * throws, and stores the output of a run that streamed one (the picked sample's, with a result
 * picker). As in TypeScript, the cache is read before the run starts, so a hit records no {@code
 * ax_gen_forward} span and no {@code ax_gen_generation} metrics. A call with a run {@code control}
 * skips the cache.
 *
 * <p>An {@link AxFlow} caches its returned output the same way, through the {@code
 * cachingFunction} of its forward call, else the process-wide one (its constructor takes none): a
 * hit runs no node and records no {@code ax_gen_flow_forward} span and no {@code ax_gen_flow}
 * metrics, and the flow ignores exceptions from its own reads and stores. The call's
 * options reach the flow's AxGen nodes, so they cache their outputs too, and a node's read
 * exception fails the flow as it fails that node's forward. {@link AxFlow#streamingForward} yields
 * the output, stored or not, as one delta ({@code version} 1, {@code index} 0).
 *
 * <p>Keys are SHA-256 hex digests of the program (an AxGen's signature, an AxFlow's step plan) and
 * the input values, media data included; they are not shared with other languages. Stores get a copy of the output and reads return a copy of
 * the stored value. The function can be called from several threads at once ({@code
 * streamingForward} runs on a worker thread, and flows can run programs in parallel), so keep it
 * thread-safe.
 */
@FunctionalInterface
public interface AxCachingFunction {
  Map<String, Object> apply(String key, Map<String, Object> value) throws Exception;
}
