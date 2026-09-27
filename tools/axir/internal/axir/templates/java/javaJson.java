package dev.axllm.ax;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.math.MathContext;
import java.math.RoundingMode;
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
      for (Map.Entry<?, ?> e : ownKeyOrder(map)) parts.add(stringify(String.valueOf(e.getKey())) + ":" + stringify(e.getValue()));
      return "{" + String.join(",", parts) + "}";
    }
    if (value instanceof Iterable<?> items) {
      List<String> parts = new ArrayList<>();
      for (Object item : items) parts.add(stringify(item));
      return "[" + String.join(",", parts) + "]";
    }
    return stringify(String.valueOf(value));
  }

  // A map's entries in JavaScript's own-property order, which JSON.stringify
  // follows: array-index keys ("0" to "4294967294" in canonical form) first
  // in ascending numeric order, then the other keys in insertion order.
  private static List<Map.Entry<?, ?>> ownKeyOrder(Map<?, ?> map) {
    List<Map.Entry<?, ?>> indexed = new ArrayList<>();
    List<Map.Entry<?, ?>> named = new ArrayList<>();
    for (Map.Entry<?, ?> e : map.entrySet()) {
      if (arrayIndex(String.valueOf(e.getKey())) >= 0) indexed.add(e);
      else named.add(e);
    }
    if (indexed.isEmpty()) return named;
    indexed.sort(java.util.Comparator.comparingLong(e -> arrayIndex(String.valueOf(e.getKey()))));
    indexed.addAll(named);
    return indexed;
  }

  // The array index a JavaScript property key names, else -1.
  private static long arrayIndex(String key) {
    int n = key.length();
    if (n == 0 || n > 10 || (n > 1 && key.charAt(0) == '0')) return -1;
    for (int i = 0; i < n; i++) {
      char c = key.charAt(i);
      if (c < '0' || c > '9') return -1;
    }
    long index = Long.parseLong(key);
    return index <= 4294967294L ? index : -1;
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

  // JSON.stringify: numberText, with null for NaN and the infinities.
  private static String numberString(Number number) {
    String text = numberText(number);
    return text.equals("NaN") || text.endsWith("Infinity") ? "null" : text;
  }

  // A number as JavaScript's String(x) writes it. Integer types (Json.parse
  // reads integer literals that fit in a long as Long) keep their exact
  // digits; doubles and floats get Number.prototype.toString's text: shortest
  // round-trip digits, plain decimals from 1e-6 up to 1e21, exponent form
  // outside that range (1e-7, 1.5e+21), and 0 for -0.
  static String numberText(Number number) {
    if (number instanceof Long || number instanceof Integer || number instanceof Short || number instanceof Byte || number instanceof BigInteger) return number.toString();
    // A float keeps its own shortest digits (0.1f is 0.1, not 0.10000000149011612).
    double d = number instanceof Float f ? Double.parseDouble(Float.toString(f)) : number.doubleValue();
    if (Double.isNaN(d)) return "NaN";
    if (Double.isInfinite(d)) return d > 0 ? "Infinity" : "-Infinity";
    if (d == 0) return "0";
    // Integral values below 2^53 print exactly as integers (the common case).
    if (d == Math.rint(d) && Math.abs(d) < 9007199254740992.0) return Long.toString((long) d);
    BigDecimal shortest = shortestDecimal(Math.abs(d)).stripTrailingZeros();
    String digits = shortest.unscaledValue().toString();
    int k = digits.length();
    int n = k - shortest.scale();  // digits before the decimal point
    StringBuilder out = new StringBuilder(d < 0 ? "-" : "");
    if (k <= n && n <= 21) {
      out.append(digits).append("0".repeat(n - k));
    } else if (0 < n && n <= 21) {
      out.append(digits, 0, n).append('.').append(digits, n, k);
    } else if (-6 < n && n <= 0) {
      out.append("0.").append("0".repeat(-n)).append(digits);
    } else {
      out.append(digits.charAt(0));
      if (k > 1) out.append('.').append(digits, 1, k);
      out.append(n - 1 < 0 ? "e-" : "e+").append(Math.abs(n - 1));
    }
    return out.toString();
  }

  // The shortest decimal that parses back to d (finite, > 0), as JavaScript
  // picks it; Double.toString is not always the shortest before JDK 19. Round
  // the exact value to 1, 2, ... significant digits (half even). At a power of
  // two the round-trip interval is lopsided, so the neighbour on the other
  // side of d can parse back when the nearest decimal does not.
  private static BigDecimal shortestDecimal(double d) {
    BigDecimal exact = new BigDecimal(d);
    for (int precision = 1; precision < 17; precision++) {
      BigDecimal nearest = exact.round(new MathContext(precision, RoundingMode.HALF_EVEN));
      if (nearest.doubleValue() == d) return nearest;
      BigDecimal step = nearest.ulp();
      BigDecimal other = nearest.compareTo(exact) < 0 ? nearest.add(step) : nearest.subtract(step);
      if (other.signum() > 0 && other.doubleValue() == d) return other;
    }
    return exact.round(new MathContext(17, RoundingMode.HALF_EVEN));
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
      for (Map.Entry<?, ?> e : ownKeyOrder(map)) {
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
      if (floating) return Double.parseDouble(text);
      // Integers past the long range parse as doubles, as JSON.parse reads them.
      try {
        return Long.parseLong(text);
      } catch (NumberFormatException tooLarge) {
        return Double.parseDouble(text);
      }
    }
    void skip() { while (pos < src.length() && Character.isWhitespace(src.charAt(pos))) pos++; }
    char peek() { return pos < src.length() ? src.charAt(pos) : '\0'; }
    boolean match(char c) { skip(); if (peek() == c) { pos++; return true; } return false; }
    void expect(char c) { skip(); if (peek() != c) throw new IllegalArgumentException("expected " + c); pos++; }
  }
}
