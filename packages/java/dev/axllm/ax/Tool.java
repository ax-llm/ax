package dev.axllm.ax;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

public final class Tool {
  public interface Handler {
    Object call(Map<String, Object> args) throws Exception;
  }

  public final String name;
  public final String description;
  public final List<Field> args;
  public final List<Field> returns;
  public final Handler handler;

  Tool(String name, String description, List<Field> args, List<Field> returns, Handler handler) {
    this.name = name;
    this.description = description;
    this.args = List.copyOf(args);
    this.returns = List.copyOf(returns);
    this.handler = handler;
  }

  public Map<String, Object> schema() {
    return Core.asMap(Core.to_json_schema(args, "Schema", java.util.Map.of()));
  }

  public Object call(Map<String, Object> values) {
    Core.validate_fields(args, values, "tool." + name + ".args");
    try {
      Object result = handler.call(values);
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

    public Builder(String name) { this.name = name; }
    public Builder description(String text) { description = text; return this; }
    public Builder arg(String name, Field.Fluent field) { args.add(field.toField(name)); return this; }
    public Builder returnsField(String name, Field.Fluent field) { returns.add(field.toField(name)); return this; }
    public Builder handler(Handler handler) { this.handler = handler; return this; }
    public Tool build() {
      if (name == null || name.isBlank()) throw new IllegalArgumentException("fn() requires a non-empty function name");
      if (description == null || description.isBlank()) throw new IllegalArgumentException("Function '" + name + "' must define a description");
      if (handler == null) throw new IllegalArgumentException("Function '" + name + "' must define a handler");
      return new Tool(name, description, args, returns, handler);
    }
  }
}
