package dev.axllm.ax;

import java.util.ArrayList;
import java.util.List;

public final class AxSignature {
  public final String description;
  public final List<Field> inputs;
  public final List<Field> outputs;
  public boolean forceStructured;

  public AxSignature(String description, List<Field> inputs, List<Field> outputs) {
    this.description = description;
    this.inputs = List.copyOf(inputs == null ? List.of() : inputs);
    this.outputs = List.copyOf(outputs == null ? List.of() : outputs);
    Core.validate_signature(this);
  }

  public static AxSignature create(String signature) {
    return (AxSignature) Core.parse_signature(signature);
  }

  public List<Field> getInputFields() { return inputs; }
  public List<Field> getOutputFields() { return outputs; }
  public String getDescription() { return description; }

  public boolean hasComplexFields() {
    if (forceStructured) return true;
    for (Field field : outputs) {
      if ("object".equals(field.type.name) || field.type.fields != null) return true;
    }
    return false;
  }

  @Override public String toString() { return String.valueOf(Core.signature_to_string(this)); }

  public java.util.Map<String, Object> toJsonSchema(String target, java.util.Map<String, Object> options) {
    List<Field> fields = "inputs".equals(target) ? inputs : outputs;
    return Core.asMap(Core.to_json_schema(fields, "Schema", options == null ? java.util.Map.of() : options));
  }

  public static final class Builder {
    private final List<Field> inputs = new ArrayList<>();
    private final List<Field> outputs = new ArrayList<>();
    private String description;
    private boolean forceStructured;

    public Builder input(String name, Field.Fluent field) { inputs.add(field.toField(name)); return this; }
    public Builder output(String name, Field.Fluent field) { outputs.add(field.toField(name)); return this; }
    public Builder description(String text) { description = text; return this; }
    public Builder useStructured() { forceStructured = true; return this; }
    public AxSignature build() {
      AxSignature sig = new AxSignature(description, inputs, outputs);
      sig.forceStructured = forceStructured;
      return sig;
    }
  }
}

class AxSignatureError extends IllegalArgumentException {
  AxSignatureError(String message) { super(message); }
}
