package dev.axllm.ax;

import java.util.LinkedHashMap;
import java.util.Map;

public record AxEventRoute(String id, String action, Map<String,Object> match, String targetId, boolean requireAuthenticated, String ordering, long debounceMs, Map<String,Object> instanceKey) {
  public AxEventRoute(String id,String action,Map<String,Object> match){this(id,action,match,null,false,"strict",0,null);}
  public AxEventRoute(String id,String action,Map<String,Object> match,String targetId,boolean requireAuthenticated,String ordering,long debounceMs){this(id,action,match,targetId,requireAuthenticated,ordering,debounceMs,null);}
  public Map<String,Object> toMap(){Map<String,Object> out=new LinkedHashMap<>();out.put("id",id);out.put("action",action);out.put("match",match);out.put("targetId",targetId);out.put("requireAuthenticated",requireAuthenticated);out.put("ordering",ordering);out.put("debounceMs",debounceMs);out.put("instanceKey",instanceKey);return out;}
}
