package dev.axllm.ax;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

public final class Tool {
  public interface Handler {
    Object call(Map<String, Object> args) throws Exception;
  }

  @FunctionalInterface public interface ContextHandler {
    Object call(Map<String,Object> args, java.util.function.BooleanSupplier cancelled) throws Exception;
  }
  public final ContextHandler contextHandler;
  public final String name;
  public final String description;
  public final List<Field> args;
  public final List<Field> returns;
  public final Handler handler;
  public final String execution;
  private Map<String,Object> parameters;

  public Tool parameters(Map<String,Object> schema) {
    Tool copy = new Tool(name,description,args,returns,handler,execution,contextHandler);
    copy.parameters = Core.asMap(Json.parse(Json.stringify(schema)));
    return copy;
  }

  Tool(String name, String description, List<Field> args, List<Field> returns, Handler handler) {
    this(name, description, args, returns, handler, "blocking");
  }

  Tool(String name, String description, List<Field> args, List<Field> returns, Handler handler, String execution) {
    this(name,description,args,returns,handler,execution,null);
  }
  Tool(String name,String description,List<Field> args,List<Field> returns,Handler handler,String execution,ContextHandler contextHandler) {
    this.contextHandler=contextHandler;
    this.execution = execution;
    this.name = name;
    this.description = description;
    this.args = List.copyOf(args);
    this.returns = List.copyOf(returns);
    this.handler = handler;
  }

  public Map<String, Object> schema() {
    if (parameters != null) return Core.asMap(Json.parse(Json.stringify(parameters)));
    return Core.asMap(Core.to_json_schema(args, "Schema", java.util.Map.of()));
  }

  public Object call(Map<String,Object> values) {return call(values,()->Thread.currentThread().isInterrupted());}
  public Object call(Map<String, Object> values,java.util.function.BooleanSupplier cancelled) {
    Core.validate_fields(args, values, "tool." + name + ".args");
    try {
      Object result = contextHandler==null?handler.call(values):contextHandler.call(values,cancelled);
      if (!returns.isEmpty() && result instanceof Map<?, ?> map) Core.validate_fields(returns, map, "tool." + name + ".return");
      return result;
    } catch (RuntimeException e) {
      throw e;
    } catch (Exception e) {
      throw new RuntimeException(e.getMessage(), e);
    }
  }

  public static final class Builder {
    private final String name;
    private String description;
    private final List<Field> args = new ArrayList<>();
    private final List<Field> returns = new ArrayList<>();
    private Handler handler;
    private ContextHandler contextHandler;
    private String execution = "blocking";
    private Map<String,Object> parameters;
    public Builder parameters(Map<String,Object> schema) { parameters = schema; return this; }

    public Builder(String name) { this.name = name; }
    public Builder execution(String mode) {
      if (!"blocking".equals(mode) && !"background".equals(mode)) throw new IllegalArgumentException("Tool execution must be blocking or background");
      execution = mode; return this;
    }
    public Builder description(String text) { description = text; return this; }
    public Builder arg(String name, Field.Fluent field) { args.add(field.toField(name)); return this; }
    public Builder returnsField(String name, Field.Fluent field) { returns.add(field.toField(name)); return this; }
    public Builder handler(Handler handler) { this.handler = handler; return this; }
    public Builder contextHandler(ContextHandler handler){this.contextHandler=handler;return this;}
    public Tool build() {
      if (name == null || name.isBlank()) throw new IllegalArgumentException("fn() requires a non-empty function name");
      if (description == null || description.isBlank()) throw new IllegalArgumentException("Function '" + name + "' must define a description");
      if (handler == null && contextHandler==null) throw new IllegalArgumentException("Function '" + name + "' must define a handler");
      Tool tool = new Tool(name, description, args, returns, handler, execution,contextHandler);
      return parameters == null ? tool : tool.parameters(parameters);
    }
  }
}
