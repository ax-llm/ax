// ax-example:start
// title: Java Data Analyst (Large Context + Tools)
// group: long-agents
// description: Combines a large data dictionary held in contextFields with typed warehouse tools, so the agent answers business questions over a big dataset it never has to inline.
// provider: google-gemini
// env: GOOGLE_APIKEY
// level: advanced
// order: 30
// ax-example:end
import dev.axllm.ax.*;
import dev.axllm.ax.runtime.quickjs.*;
import java.util.*;

public final class DataAnalystWithToolsExample {
  static final String[] MONTHS = {
      "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"};

  @SuppressWarnings("unchecked")
  static Map<String, Object> asMap(Object value) {
    return value instanceof Map<?, ?> ? (Map<String, Object>) value : new LinkedHashMap<>();
  }

  // ---------------------------------------------------------------------------
  // The "warehouse": a few hundred rows that live in the host process and are
  // reachable only through tools. The model never sees the rows -- it queries
  // them. Deterministic so the example is reproducible.
  // ---------------------------------------------------------------------------
  static List<Map<String, Object>> buildWarehouse() {
    String[] regions = {"North", "South", "East", "West", "Central", "NW", "NE", "SE"};
    String[] products = {"Widget-A", "Widget-B", "Gadget-X", "Gadget-Y"};
    List<Map<String, Object>> rows = new ArrayList<>();
    long[] seed = {7};

    java.util.function.DoubleSupplier rand = () -> {
      seed[0] = (seed[0] * 1103515245L + 12345L) & 0x7FFFFFFFL;
      return (double) seed[0] / 0x7FFFFFFFL;
    };

    for (String region : regions) {
      for (String product : products) {
        int trend = (product.equals("Gadget-X") && region.equals("East")) ? 90 : 25; // a planted winner
        for (int m = 0; m < MONTHS.length; m++) {
          long units = Math.round(400 + rand.getAsDouble() * 1200 + m * trend);
          int price = product.startsWith("Gadget") ? 60 : 38;
          double returnRate = Math.round(
              (0.01 + rand.getAsDouble() * 0.05 + (product.equals("Widget-B") ? 0.03 : 0)) * 1000.0) / 1000.0;
          Map<String, Object> row = new LinkedHashMap<>();
          row.put("region", region);
          row.put("product", product);
          row.put("monthIndex", m);
          row.put("month", MONTHS[m]);
          row.put("units", units);
          row.put("revenue", units * price);
          row.put("returnRate", returnRate);
          rows.add(row);
        }
      }
    }
    return rows;
  }

  // The schema/data dictionary is large-ish and goes into contextFields so the
  // agent orients on column meaning + business rules without the doc entering the prompt.
  static final String SCHEMA = String.join("\n",
      "TABLE sales (one row per region x product x month)",
      "",
      "COLUMNS",
      "  region       text   one of: North, South, East, West, Central, NW, NE, SE",
      "  product      text   one of: Widget-A, Widget-B, Gadget-X, Gadget-Y",
      "  month        text   Jan..Dec (calendar order; monthIndex 0..11)",
      "  units        int    units sold that month",
      "  revenue      int    integer dollars (units * unit price; Gadgets cost more)",
      "  returnRate   float  fraction of units returned, 0..1",
      "",
      "BUSINESS RULES",
      "  - \"Growth\" = change in monthly revenue from Jan to Dec for a region+product.",
      "  - A return rate above 0.05 (5%) is flagged for quality review.",
      "  - Compare like-for-like: always group by region AND product, not either alone.",
      "",
      "TOOLS AVAILABLE (call them, never invent figures)",
      "  query  filter + aggregate a slice -> {matched, totalUnits, totalRevenue, avgReturnRate}",
      "  top    rank a metric (\"revenue\"|\"units\") grouped by \"product\"|\"region\" -> [{key, value}]",
      "  trend  monthly revenue series (Jan..Dec) for one region + product");

  public static void main(String[] args) throws Exception {
    String apiKey = System.getenv("GOOGLE_APIKEY");
    if (apiKey == null || apiKey.isBlank()) {
      throw new IllegalStateException("Set GOOGLE_APIKEY to run this example.");
    }

    GoogleGeminiClient client = new GoogleGeminiClient(Map.of(
        "api_key", apiKey, "model", "gemini-3-flash-preview"));

    List<Map<String, Object>> warehouse = buildWarehouse();
    System.out.println("Warehouse: " + warehouse.size() + " rows (kept out of the prompt).");

    // --- Host tool handlers over the warehouse (the model never sees the rows) ---
    AxQuickJsHostCallable queryTool = params -> {
      Map<String, Object> p = asMap(params);
      String region = p.get("region") == null ? null : String.valueOf(p.get("region"));
      String product = p.get("product") == null ? null : String.valueOf(p.get("product"));
      String month = p.get("month") == null ? null : String.valueOf(p.get("month"));
      List<Map<String, Object>> rows = new ArrayList<>();
      for (Map<String, Object> r : warehouse) {
        if (region != null && !region.isBlank() && !region.equals(r.get("region"))) continue;
        if (product != null && !product.isBlank() && !product.equals(r.get("product"))) continue;
        if (month != null && !month.isBlank() && !month.equals(r.get("month"))) continue;
        rows.add(r);
      }
      long totalUnits = 0;
      long totalRevenue = 0;
      double sumReturn = 0;
      for (Map<String, Object> r : rows) {
        totalUnits += ((Number) r.get("units")).longValue();
        totalRevenue += ((Number) r.get("revenue")).longValue();
        sumReturn += ((Number) r.get("returnRate")).doubleValue();
      }
      double avgReturn = rows.isEmpty() ? 0 : Math.round((sumReturn / rows.size()) * 10000.0) / 10000.0;
      return Map.of(
          "matched", rows.size(), "totalUnits", totalUnits,
          "totalRevenue", totalRevenue, "avgReturnRate", avgReturn);
    };

    AxQuickJsHostCallable topTool = params -> {
      Map<String, Object> p = asMap(params);
      String metric = String.valueOf(p.getOrDefault("metric", "revenue"));
      String groupBy = String.valueOf(p.getOrDefault("groupBy", "product"));
      int limit = p.get("limit") instanceof Number n ? n.intValue() : 5;
      Map<String, Long> totals = new LinkedHashMap<>();
      for (Map<String, Object> r : warehouse) {
        String key = "region".equals(groupBy) ? String.valueOf(r.get("region")) : String.valueOf(r.get("product"));
        long value = "units".equals(metric)
            ? ((Number) r.get("units")).longValue()
            : ((Number) r.get("revenue")).longValue();
        totals.merge(key, value, Long::sum);
      }
      List<Map<String, Object>> ranked = new ArrayList<>();
      for (Map.Entry<String, Long> e : totals.entrySet()) {
        ranked.add(Map.of("key", e.getKey(), "value", e.getValue()));
      }
      ranked.sort((a, b) -> Long.compare((Long) b.get("value"), (Long) a.get("value")));
      return ranked.subList(0, Math.min(limit, ranked.size()));
    };

    AxQuickJsHostCallable trendTool = params -> {
      Map<String, Object> p = asMap(params);
      String region = String.valueOf(p.get("region"));
      String product = String.valueOf(p.get("product"));
      long[] series = new long[12];
      for (Map<String, Object> r : warehouse) {
        if (region.equals(r.get("region")) && product.equals(r.get("product"))) {
          series[((Number) r.get("monthIndex")).intValue()] = ((Number) r.get("revenue")).longValue();
        }
      }
      List<Long> out = new ArrayList<>();
      for (long v : series) out.add(v);
      return out;
    };

    AxAgent analyst = Ax.agent(
        "schema:string, question:string -> answer:string, evidence:string[] \"Concrete figures the answer is based on\"",
        Map.of(
            // Big data dictionary stays out of the prompt.
            "contextFields", List.of("schema"),
            // Tool specs advertised to the model; handlers are registered on the runtime below.
            "functions", List.of(
                Map.of(
                    "name", "query",
                    "description", "Filter the sales table and return aggregates for the matching rows.",
                    "parameters", Map.of(
                        "type", "object",
                        "properties", Map.of(
                            "region", Map.of("type", "string"),
                            "product", Map.of("type", "string"),
                            "month", Map.of("type", "string")))),
                Map.of(
                    "name", "top",
                    "description", "Rank a metric (revenue|units) grouped by product|region, highest first.",
                    "parameters", Map.of(
                        "type", "object",
                        "properties", Map.of(
                            "metric", Map.of("type", "string"),
                            "groupBy", Map.of("type", "string"),
                            "limit", Map.of("type", "number")),
                        "required", List.of("metric", "groupBy"))),
                Map.of(
                    "name", "trend",
                    "description", "Monthly revenue series (Jan..Dec) for one region and product.",
                    "parameters", Map.of(
                        "type", "object",
                        "properties", Map.of(
                            "region", Map.of("type", "string"),
                            "product", Map.of("type", "string")),
                        "required", List.of("region", "product")))),
            "contextPolicy", Map.of("preset", "lean", "budget", "balanced"),
            "runtime", Map.of("language", "JavaScript")));

    try (AxQuickJsCodeRuntime runtime = new AxQuickJsCodeRuntime()) {
      runtime.registerCallable("query", queryTool);
      runtime.registerCallable("top", topTool);
      runtime.registerCallable("trend", trendTool);

      Map<String, Object> result = analyst.forward(
          client,
          Map.of(
              "schema", SCHEMA,
              "question", "Which region+product had the strongest Jan->Dec revenue growth, and which products have an average return rate above the 5% review threshold? Tool-calling rules: the tools are bare async functions named exactly `query`, `top`, `trend` -- call them as `await query({product:'Widget-B'})`, never as `tools.query(...)`. Do NOT wrap your turn in an IIFE like `(async()=>{...})()`; write top-level `await` and capture results in variables, then `console.log` one value to inspect, and only call `await final(task, evidence)` once you have the figures."),
          Map.of("runtime", runtime, "max_actor_steps", 40));

      System.out.println(Json.pretty(result));
    }
  }
}
