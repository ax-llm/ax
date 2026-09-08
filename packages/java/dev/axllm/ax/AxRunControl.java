package dev.axllm.ax;

import java.util.*;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

public final class AxRunControl {
  private final AxRunControl parent;
  private final Consumer<Map<String,Object>> relay;
  public AxRunControl(){this(null,null);}
  AxRunControl(AxRunControl parent,Consumer<Map<String,Object>> relay){this.parent=parent;this.relay=relay;}
  private final AtomicBoolean aborted = new AtomicBoolean();
  private final List<Map<String,Object>> updates = new ArrayList<>();
  private final List<Consumer<Map<String,Object>>> listeners = new CopyOnWriteArrayList<>();
  public boolean isAborted() { return aborted.get() || (parent!=null && parent.isAborted()); }
  public void abort() { if (aborted.compareAndSet(false,true)) emit(Map.of("type","aborted","path","root")); }
  public AutoCloseable onEvent(Consumer<Map<String,Object>> listener) { listeners.add(listener); return () -> listeners.remove(listener); }
  public void steer(String text) { steer(text,"root"); }
  public void steer(String text,String target) { if(text==null || text.isBlank()) throw new IllegalArgumentException("Steering text must not be empty"); enqueue(Map.of("type","steer","text",text),target); }
  public void setThinkingTokenBudget(String level) { setThinkingTokenBudget(level,"root"); }
  public void setThinkingTokenBudget(String level,String target) {
    if(!List.of("none","minimal","low","medium","high","highest").contains(level)) throw new IllegalArgumentException("Invalid thinking token budget");
    enqueue(Map.of("type","thinking","level",level),target);
  }
  private void enqueue(Map<String,Object> value,String target) {
    String id;
    synchronized(this) { if(isAborted()) throw new IllegalStateException("Run controller is aborted"); id=String.valueOf(updates.size()+1); Map<String,Object> update=new LinkedHashMap<>(value); update.put("id",id); update.put("target",target); updates.add(update); }
    emit(Map.of("type","queued","path",target,"update_id",id));
  }
  synchronized List<Map<String,Object>> pending(String path,Set<String> seen) {
    if(parent!=null)return parent.pending(path,seen);
    List<Map<String,Object>> out=new ArrayList<>();
    for(var update:updates) if(!seen.contains(update.get("id")) && Core.truthy(Core.chat_session_target_matches(update.get("target"),path))) out.add(new LinkedHashMap<>(update));
    return out;
  }
  void emit(Map<String,Object> event) { if(relay!=null){relay.accept(new LinkedHashMap<>(event));return;} for(var listener:listeners) listener.accept(new LinkedHashMap<>(event)); }
}
