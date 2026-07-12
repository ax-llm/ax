package dev.axllm.ax;

import java.util.LinkedHashMap;
import java.util.Map;

public record AxEventEnvelope(String specversion, String id, String source, String type, String subject, Object data) {
  public AxEventEnvelope(String id, String source, String type, Object data) { this("1.0", id, source, type, null, data); }
  public Map<String,Object> toMap() { Map<String,Object> out=new LinkedHashMap<>();out.put("specversion",specversion);out.put("id",id);out.put("source",source);out.put("type",type);if(subject!=null)out.put("subject",subject);if(data!=null)out.put("data",data);return out; }
}
