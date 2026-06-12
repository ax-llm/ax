package dev.axllm.ax;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class Field {
  public final String name;
  public final FieldType type;
  public final String description;
  public final String title;
  public final boolean optional;
  public final boolean internal;
  public final boolean cached;

  public Field(String name, FieldType type, String description, String title, boolean optional, boolean internal, boolean cached) {
    this.name = name;
    this.type = type == null ? new FieldType("string") : type;
    this.description = description;
    this.title = title == null ? Core.title(name) : title;
    this.optional = optional;
    this.internal = internal;
    this.cached = cached;
  }

  public Field(String name, FieldType type, String description, boolean optional, boolean internal, boolean cached) {
    this(name, type, description, null, optional, internal, cached);
  }

  public static final class Fluent {
    private FieldType type;
    private String description;
    private String itemDescription;
    private boolean optional;
    private boolean internal;
    private boolean cached;

    Fluent(String type, String description) {
      this.type = new FieldType(type);
      this.description = description;
      this.itemDescription = description;
    }

    Fluent(FieldType type, String description, String itemDescription, boolean optional, boolean internal, boolean cached) {
      this.type = type;
      this.description = description;
      this.itemDescription = itemDescription;
      this.optional = optional;
      this.internal = internal;
      this.cached = cached;
    }

    public Fluent optional() { Fluent out = copy(); out.optional = true; return out; }
    public Fluent internal() { Fluent out = copy(); out.internal = true; return out; }
    public Fluent cache() { Fluent out = copy(); out.cached = true; return out; }
    public Fluent array() { return array(null); }
    public Fluent array(String description) {
      Fluent out = copy();
      out.type.array = true;
      if (out.itemDescription != null && out.type.description == null) out.type.description = out.itemDescription;
      if (description != null) out.description = description;
      return out;
    }
    public Fluent min(int value) {
      Fluent out = copy();
      if ("number".equals(out.type.name)) out.type.minimum = (double) value;
      else out.type.minLength = value;
      return out;
    }
    public Fluent max(int value) {
      Fluent out = copy();
      if ("number".equals(out.type.name)) out.type.maximum = (double) value;
      else out.type.maxLength = value;
      return out;
    }
    public Fluent email() { Fluent out = copy(); out.type.format = "email"; return out; }
    public Fluent url() { Fluent out = copy(); out.type.format = "uri"; return out; }
    public Fluent regex(String pattern, String patternDescription) {
      if (patternDescription == null || patternDescription.isBlank()) throw new AxSignatureError("regex() requires a pattern description");
      Fluent out = copy();
      out.type.pattern = pattern;
      out.type.patternDescription = patternDescription;
      return out;
    }

    Field toField(String name) {
      return new Field(name, type.copy(), description, null, optional, internal, cached);
    }

    FieldType toType() {
      return type.copy();
    }

    private Fluent copy() {
      return new Fluent(type.copy(), description, itemDescription, optional, internal, cached);
    }
  }

  public static final class Factory {
    public AxSignature.Builder call() { return new AxSignature.Builder(); }
    public Fluent string() { return string(null); }
    public Fluent string(String description) { return new Fluent("string", description); }
    public Fluent number() { return number(null); }
    public Fluent number(String description) { return new Fluent("number", description); }
    public Fluent boolean_() { return boolean_(null); }
    public Fluent boolean_(String description) { return new Fluent("boolean", description); }
    public Fluent json() { return json(null); }
    public Fluent json(String description) { return new Fluent("json", description); }
    public Fluent date() { return date(null); }
    public Fluent date(String description) { return new Fluent("date", description); }
    public Fluent datetime() { return datetime(null); }
    public Fluent datetime(String description) { return new Fluent("datetime", description); }
    public Fluent dateRange() { return dateRange(null); }
    public Fluent dateRange(String description) { return new Fluent("dateRange", description); }
    public Fluent datetimeRange() { return datetimeRange(null); }
    public Fluent datetimeRange(String description) { return new Fluent("datetimeRange", description); }
    public Fluent image() { return image(null); }
    public Fluent image(String description) { return new Fluent("image", description); }
    public Fluent audio() { return audio(null); }
    public Fluent audio(String description) { return new Fluent("audio", description); }
    public Fluent file() { return file(null); }
    public Fluent file(String description) { return new Fluent("file", description); }
    public Fluent url() { return url(null); }
    public Fluent url(String description) { return new Fluent("url", description); }
    public Fluent code() { return code(null); }
    public Fluent code(String description) { return new Fluent("code", description); }
    public Fluent object(Map<String, Fluent> fields) { return object(fields, null); }
    public Fluent object(Map<String, Fluent> fields, String description) {
      FieldType t = new FieldType("object");
      t.fields = new LinkedHashMap<>();
      if (fields != null) {
        for (Map.Entry<String, Fluent> entry : fields.entrySet()) {
          Field nested = entry.getValue().toField(entry.getKey());
          if (nested.description != null && nested.type.description == null) nested.type.description = nested.description;
          t.fields.put(entry.getKey(), nested);
        }
      }
      return new Fluent(t, description, description, false, false, false);
    }
    public Fluent classification(List<String> options) { return classification(options, null); }
    public Fluent classification(List<String> options, String description) {
      if (options == null || options.isEmpty()) throw new AxSignatureError("classification() requires at least one option");
      FieldType t = new FieldType("class");
      t.options = List.copyOf(options);
      return new Fluent(t, description, description, false, false, false);
    }
  }
}
