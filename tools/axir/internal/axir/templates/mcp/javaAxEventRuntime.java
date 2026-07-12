package dev.axllm.ax;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class AxEventRuntime {
  private final List<AxEventRoute> routes;
  private final Map<String,Object> options;
  private final Map<String,Object> descriptor;
  public AxEventRuntime(List<AxEventRoute> routes){this(routes,Map.of());}
  @SuppressWarnings("unchecked")
  public AxEventRuntime(List<AxEventRoute> routes,Map<String,Object> options){this.routes=List.copyOf(routes);this.options=Map.copyOf(options);this.descriptor=(Map<String,Object>)Core.event_runtime_descriptor(routeMaps(),this.options);}
  public Map<String,Object> descriptor(){return new LinkedHashMap<>(descriptor);}
  @SuppressWarnings("unchecked")
  public List<AxEventCommand> publish(AxEventEnvelope event,String identityScope,String trust){List<Map<String,Object>> values=(List<Map<String,Object>>)Core.event_route_commands(event.toMap(),routeMaps(),identityScope,trust);List<AxEventCommand> out=new ArrayList<>();for(Map<String,Object> value:values)out.add(new AxEventCommand(String.valueOf(value.get("routeId")),String.valueOf(value.get("action")),value.get("targetId")==null?null:String.valueOf(value.get("targetId")),String.valueOf(value.get("instanceKey")),String.valueOf(value.get("idempotencyKey"))));return out;}
  @SuppressWarnings("unchecked")
  public static Map<String,Object> normalizeMCP(String namespace,String method,Object params){return (Map<String,Object>)Core.event_normalize_mcp(namespace,method,params);}
  private List<Map<String,Object>> routeMaps(){List<Map<String,Object>> out=new ArrayList<>();for(AxEventRoute route:routes)out.add(route.toMap());return out;}
}
