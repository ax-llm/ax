package dev.axllm.ax;

import java.util.List;
import java.util.Map;

/** Optional normalized provider capability owned by a generation run. */
public interface AxChatSession extends AutoCloseable {
  Map<String,Object> next() throws Exception;
  void submit(List<Object> results) throws Exception;
  String update(Map<String,Object> update) throws Exception;
  void close();
  interface Provider {
    AxChatSession openChatSession(Map<String,Object> request,Map<String,Object> options) throws Exception;
  }
}

// Internal selection seam: the returned service is retained for one generation run.
interface ChatRunFeatures { Map<String,Object> getFeatures(String model); }
interface ChatRunSelector extends ChatRunFeatures {
  AiClient pinChatRun(Map<String,Object> request,Map<String,Object> options) throws Exception;
}
