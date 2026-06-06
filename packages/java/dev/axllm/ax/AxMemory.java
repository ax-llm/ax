package dev.axllm.ax;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class AxMemory {
  private final List<Map<String, Object>> items = new ArrayList<>();

  public AxMemory addRequest(Object messages) {
    Map<String, Object> item = new LinkedHashMap<>();
    item.put("role", "request");
    item.put("messages", messages);
    item.put("tags", new ArrayList<>());
    items.add(item);
    return this;
  }

  public AxMemory addResponse(Object response) {
    Map<String, Object> item = new LinkedHashMap<>();
    item.put("role", "assistant");
    item.put("response", response);
    item.put("tags", new ArrayList<>());
    items.add(item);
    return this;
  }

  public AxMemory updateResult(Object response) {
    for (int i = items.size() - 1; i >= 0; i--) {
      if ("assistant".equals(items.get(i).get("role"))) {
        items.get(i).put("response", response);
        return this;
      }
    }
    return addResponse(response);
  }

  public AxMemory addFunctionResults(Object results) {
    Map<String, Object> item = new LinkedHashMap<>();
    item.put("role", "function");
    item.put("results", results instanceof List<?> ? results : List.of(results));
    item.put("tags", new ArrayList<>());
    items.add(item);
    return this;
  }

  public AxMemory addProcessorOutput(Object output) {
    Map<String, Object> item = new LinkedHashMap<>();
    item.put("role", "processor");
    item.put("output", output);
    item.put("tags", List.of("processor"));
    items.add(item);
    return this;
  }

  public AxMemory addCorrection(Object response, Object errorMessage) {
    Map<String, Object> item = new LinkedHashMap<>();
    item.put("role", "user");
    item.put("content", "Correction: " + errorMessage);
    item.put("response", response);
    item.put("tags", List.of("correction"));
    items.add(item);
    return this;
  }

  public List<Map<String, Object>> history() {
    return new ArrayList<>(items);
  }

  public Map<String, Object> getLast() {
    return items.isEmpty() ? null : items.get(items.size() - 1);
  }

  @SuppressWarnings("unchecked")
  public AxMemory addTag(String tag) {
    if (!items.isEmpty()) {
      List<String> tags = (List<String>) items.get(items.size() - 1).computeIfAbsent("tags", ignored -> new ArrayList<String>());
      if (!tags.contains(tag)) tags.add(tag);
    }
    return this;
  }

  public AxMemory rewindToTag(String tag) {
    for (int i = items.size() - 1; i >= 0; i--) {
      if (Core.asList(items.get(i).get("tags")).contains(tag)) {
        items.subList(i + 1, items.size()).clear();
        return this;
      }
    }
    return this;
  }

  public AxMemory removeByTag(String tag) {
    items.removeIf(item -> Core.asList(item.get("tags")).contains(tag));
    return this;
  }
}
