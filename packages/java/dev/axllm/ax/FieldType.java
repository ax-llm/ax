package dev.axllm.ax;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class FieldType {
  public String name;
  public boolean array;
  public List<String> options;
  public Map<String, Object> fields;
  public Integer minLength;
  public Integer maxLength;
  public Double minimum;
  public Double maximum;
  public String pattern;
  public String patternDescription;
  public String format;
  public String language;
  public String description;

  public FieldType(String name) {
    this.name = name == null || name.isBlank() ? "string" : name;
  }

  public FieldType copy() {
    FieldType out = new FieldType(name);
    out.array = array;
    out.options = options == null ? null : List.copyOf(options);
    out.fields = fields == null ? null : new LinkedHashMap<>(fields);
    out.minLength = minLength;
    out.maxLength = maxLength;
    out.minimum = minimum;
    out.maximum = maximum;
    out.pattern = pattern;
    out.patternDescription = patternDescription;
    out.format = format;
    out.language = language;
    out.description = description;
    return out;
  }
}
