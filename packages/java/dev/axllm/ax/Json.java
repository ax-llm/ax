package dev.axllm.ax;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class Json {
  public static Object parse(String src) { return new Parser(src).parse(); }

  @SuppressWarnings("unchecked")
  public static Map<String, Object> asObject(Object value) {
    if (value == null) return new LinkedHashMap<>();
    if (value instanceof Map<?, ?> map) return (Map<String, Object>) map;
    throw new IllegalArgumentException("expected object");
  }

  @SuppressWarnings("unchecked")
  public static List<Object> asList(Object value) {
    if (value instanceof List<?> list) return (List<Object>) list;
    return new ArrayList<>();
  }

  public static String stringify(Object value) {
    if (value == null) return "null";
    if (value instanceof String s) return quote(s);
    if (value instanceof Number number) return numberString(number);
    if (value instanceof Boolean) return String.valueOf(value);
    if (value instanceof Map<?, ?> map) {
      List<String> parts = new ArrayList<>();
      for (Map.Entry<?, ?> e : map.entrySet()) parts.add(stringify(String.valueOf(e.getKey())) + ":" + stringify(e.getValue()));
      return "{" + String.join(",", parts) + "}";
    }
    if (value instanceof Iterable<?> items) {
      List<String> parts = new ArrayList<>();
      for (Object item : items) parts.add(stringify(item));
      return "[" + String.join(",", parts) + "]";
    }
    return stringify(String.valueOf(value));
  }

  // JSON string (RFC 8259): the quote, the backslash and U+0000-U+001F are escaped
  // (\b \f \n \r \t, other controls as a backslash-u00XX escape); every other
  // character is written as is.
  private static String quote(String s) {
    StringBuilder out = new StringBuilder(s.length() + 2).append('"');
    for (int i = 0; i < s.length(); i++) {
      char c = s.charAt(i);
      switch (c) {
        case '"' -> out.append("\\\"");
        case '\\' -> out.append("\\\\");
        case '\b' -> out.append("\\b");
        case '\f' -> out.append("\\f");
        case '\n' -> out.append("\\n");
        case '\r' -> out.append("\\r");
        case '\t' -> out.append("\\t");
        default -> {
          if (c < 0x20) out.append(String.format("\\u%04x", (int) c));
          else out.append(c);
        }
      }
    }
    return out.append('"').toString();
  }

  private static String numberString(Number number) {
    if (number instanceof Double d && Double.isFinite(d) && d == Math.rint(d)) return String.valueOf(d.longValue());
    if (number instanceof Float f && Float.isFinite(f) && f == Math.rint(f)) return String.valueOf(f.longValue());
    return String.valueOf(number);
  }

  public static String stableStringify(Object value) {
    if (value == null) return "null";
    if (value instanceof String || value instanceof Number || value instanceof Boolean) return stringify(value);
    if (value instanceof Map<?, ?> map) {
      List<String> keys = new ArrayList<>();
      for (Object key : map.keySet()) keys.add(String.valueOf(key));
      java.util.Collections.sort(keys);
      List<String> parts = new ArrayList<>();
      for (String key : keys) parts.add(stringify(key) + ":" + stableStringify(map.get(key)));
      return "{" + String.join(",", parts) + "}";
    }
    if (value instanceof Iterable<?> items) {
      List<String> parts = new ArrayList<>();
      for (Object item : items) parts.add(stableStringify(item));
      return "[" + String.join(",", parts) + "]";
    }
    return stringify(String.valueOf(value));
  }

  // JSON.stringify(value, null, 2): two-space indentation, keys in insertion
  // order, and {} or [] for empty containers.
  public static String pretty(Object value) {
    StringBuilder out = new StringBuilder();
    writePretty(out, value, "");
    return out.toString();
  }

  private static void writePretty(StringBuilder out, Object value, String indent) {
    String inner = indent + "  ";
    if (value instanceof Map<?, ?> map) {
      if (map.isEmpty()) { out.append("{}"); return; }
      out.append("{\n");
      boolean first = true;
      for (Map.Entry<?, ?> e : map.entrySet()) {
        if (!first) out.append(",\n");
        first = false;
        out.append(inner).append(quote(String.valueOf(e.getKey()))).append(": ");
        writePretty(out, e.getValue(), inner);
      }
      out.append('\n').append(indent).append('}');
    } else if (value instanceof Iterable<?> items) {
      if (!items.iterator().hasNext()) { out.append("[]"); return; }
      out.append("[\n");
      boolean first = true;
      for (Object item : items) {
        if (!first) out.append(",\n");
        first = false;
        out.append(inner);
        writePretty(out, item, inner);
      }
      out.append('\n').append(indent).append(']');
    } else {
      out.append(stringify(value));
    }
  }

  private static final class Parser {
    private final String src;
    private int pos;
    Parser(String src) { this.src = src == null ? "" : src.trim(); }
    Object parse() { skip(); Object v = value(); skip(); return v; }
    Object value() {
      skip();
      if (match('{')) return object();
      if (match('[')) return array();
      if (peek() == '"') return string();
      if (src.startsWith("true", pos)) { pos += 4; return true; }
      if (src.startsWith("false", pos)) { pos += 5; return false; }
      if (src.startsWith("null", pos)) { pos += 4; return null; }
      return number();
    }
    Map<String, Object> object() {
      Map<String, Object> out = new LinkedHashMap<>();
      skip(); if (match('}')) return out;
      while (true) {
        String key = string(); expect(':'); out.put(key, value()); skip();
        if (match('}')) return out; expect(',');
      }
    }
    List<Object> array() {
      List<Object> out = new ArrayList<>();
      skip(); if (match(']')) return out;
      while (true) { out.add(value()); skip(); if (match(']')) return out; expect(','); }
    }
    String string() {
      expect('"'); StringBuilder b = new StringBuilder();
      while (pos < src.length()) {
        char c = src.charAt(pos++);
        if (c == '"') break;
        if (c == '\\' && pos < src.length()) {
          char e = src.charAt(pos++);
          if (e == 'n') c = '\n';
          else if (e == 't') c = '\t';
          else if (e == 'r') c = '\r';
          else if (e == 'b') c = '\b';
          else if (e == 'f') c = '\f';
          else if (e == 'u' && pos + 4 <= src.length()) {
            c = (char) Integer.parseInt(src.substring(pos, pos + 4), 16);
            pos += 4;
          } else c = e;
        }
        b.append(c);
      }
      return b.toString();
    }
    Number number() {
      int start = pos; if (peek() == '-') pos++;
      while (pos < src.length() && Character.isDigit(src.charAt(pos))) pos++;
      boolean floating = false;
      if (pos < src.length() && src.charAt(pos) == '.') { floating = true; pos++; while (pos < src.length() && Character.isDigit(src.charAt(pos))) pos++; }
      if (pos < src.length() && (src.charAt(pos) == 'e' || src.charAt(pos) == 'E')) {
        floating = true; pos++; if (peek() == '+' || peek() == '-') pos++; while (pos < src.length() && Character.isDigit(src.charAt(pos))) pos++;
      }
      String text = src.substring(start, pos);
      return floating ? Double.parseDouble(text) : Long.parseLong(text);
    }
    void skip() { while (pos < src.length() && Character.isWhitespace(src.charAt(pos))) pos++; }
    char peek() { return pos < src.length() ? src.charAt(pos) : '\0'; }
    boolean match(char c) { skip(); if (peek() == c) { pos++; return true; } return false; }
    void expect(char c) { skip(); if (peek() != c) throw new IllegalArgumentException("expected " + c); pos++; }
  }
}
