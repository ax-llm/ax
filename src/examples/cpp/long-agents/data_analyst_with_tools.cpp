// ax-example:start
// title: C++ Data Analyst (Large Context + Tools)
// group: long-agents
// description: Combines a large data dictionary held in contextFields with typed warehouse tools, so the agent answers business questions over a big dataset it never has to inline.
// provider: google-gemini
// env: GOOGLE_APIKEY
// level: advanced
// order: 30
// ax-example:end
#include "axllm/axllm.hpp"
#include "axllm/runtime/quickjs/quickjs_runtime.hpp"
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <string>
#include <vector>

// ---------------------------------------------------------------------------
// The "warehouse": a few hundred rows that live in the host process and are
// reachable only through tools. The model never sees the rows -- it queries
// them. Deterministic so the example is reproducible.
// ---------------------------------------------------------------------------
static const std::vector<std::string> MONTHS = {
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"};

struct Row {
  std::string region;
  std::string product;
  int monthIndex;
  std::string month;
  long units;
  long revenue;
  double returnRate;
};

static std::vector<Row> build_warehouse() {
  const std::vector<std::string> regions = {"North", "South", "East", "West", "Central", "NW", "NE", "SE"};
  const std::vector<std::string> products = {"Widget-A", "Widget-B", "Gadget-X", "Gadget-Y"};
  std::vector<Row> rows;
  std::int64_t seed = 7;

  auto rand = [&]() {
    seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF;
    return static_cast<double>(seed) / static_cast<double>(0x7FFFFFFF);
  };

  for (const auto& region : regions) {
    for (const auto& product : products) {
      int trend = (product == "Gadget-X" && region == "East") ? 90 : 25;  // a planted winner
      for (int m = 0; m < static_cast<int>(MONTHS.size()); ++m) {
        long units = std::llround(400 + rand() * 1200 + m * trend);
        int price = product.rfind("Gadget", 0) == 0 ? 60 : 38;
        double raw_return = 0.01 + rand() * 0.05 + (product == "Widget-B" ? 0.03 : 0.0);
        double return_rate = std::round(raw_return * 1000.0) / 1000.0;
        rows.push_back(Row{region, product, m, MONTHS[m], units, units * price, return_rate});
      }
    }
  }
  return rows;
}

int main() {
  const char* key = std::getenv("GOOGLE_APIKEY");
  if (key == nullptr || std::string(key).empty()) {
    std::cerr << "Set GOOGLE_APIKEY to run this example.\n";
    return 2;
  }
  const char* model = std::getenv("AX_GEMINI_MODEL");
  axllm::GoogleGeminiClient client(axllm::object({
      {"api_key", key},
      {"model", model == nullptr || std::string(model).empty() ? "gemini-3-flash-preview" : model},
  }));

  std::vector<Row> warehouse = build_warehouse();
  std::cout << "Warehouse: " << warehouse.size() << " rows (kept out of the prompt).\n";

  // The schema/data dictionary is large-ish and goes into contextFields so the
  // agent orients on column meaning + business rules without the doc entering the prompt.
  std::string schema =
      "TABLE sales (one row per region x product x month)\n"
      "\n"
      "COLUMNS\n"
      "  region       text   one of: North, South, East, West, Central, NW, NE, SE\n"
      "  product      text   one of: Widget-A, Widget-B, Gadget-X, Gadget-Y\n"
      "  month        text   Jan..Dec (calendar order; monthIndex 0..11)\n"
      "  units        int    units sold that month\n"
      "  revenue      int    integer dollars (units * unit price; Gadgets cost more)\n"
      "  returnRate   float  fraction of units returned, 0..1\n"
      "\n"
      "BUSINESS RULES\n"
      "  - \"Growth\" = change in monthly revenue from Jan to Dec for a region+product.\n"
      "  - A return rate above 0.05 (5%) is flagged for quality review.\n"
      "  - Compare like-for-like: always group by region AND product, not either alone.\n"
      "\n"
      "TOOLS AVAILABLE (call them, never invent figures)\n"
      "  query  filter + aggregate a slice -> {matched, totalUnits, totalRevenue, avgReturnRate}\n"
      "  top    rank a metric (\"revenue\"|\"units\") grouped by \"product\"|\"region\" -> [{key, value}]\n"
      "  trend  monthly revenue series (Jan..Dec) for one region + product";

  // --- Host tool handlers over the warehouse (the model never sees the rows) ---
  axllm::runtime::quickjs::QuickJsCodeRuntime runtime;
  runtime
      .register_callable("query", [&warehouse](axllm::Value p) -> axllm::Value {
        std::string region = axllm::display(axllm::Core::get(p, "region", ""));
        std::string product = axllm::display(axllm::Core::get(p, "product", ""));
        std::string month = axllm::display(axllm::Core::get(p, "month", ""));
        long matched = 0, total_units = 0, total_revenue = 0;
        double sum_return = 0.0;
        for (const auto& r : warehouse) {
          if (!region.empty() && r.region != region) continue;
          if (!product.empty() && r.product != product) continue;
          if (!month.empty() && r.month != month) continue;
          ++matched;
          total_units += r.units;
          total_revenue += r.revenue;
          sum_return += r.returnRate;
        }
        double avg_return = matched > 0 ? std::round((sum_return / matched) * 10000.0) / 10000.0 : 0.0;
        return axllm::object({
            {"matched", static_cast<double>(matched)},
            {"totalUnits", static_cast<double>(total_units)},
            {"totalRevenue", static_cast<double>(total_revenue)},
            {"avgReturnRate", avg_return},
        });
      })
      .register_callable("top", [&warehouse](axllm::Value p) -> axllm::Value {
        std::string metric = axllm::display(axllm::Core::get(p, "metric", "revenue"));
        std::string group_by = axllm::display(axllm::Core::get(p, "groupBy", "product"));
        double limit_raw = 5;
        axllm::Value limit_val = axllm::Core::get(p, "limit", axllm::Value());
        if (limit_val.is_number()) limit_raw = std::stod(axllm::display(limit_val));
        std::size_t limit = limit_raw > 0 ? static_cast<std::size_t>(limit_raw) : 5;

        std::vector<std::pair<std::string, long>> totals;
        auto bump = [&](const std::string& key, long value) {
          for (auto& entry : totals) {
            if (entry.first == key) {
              entry.second += value;
              return;
            }
          }
          totals.push_back({key, value});
        };
        for (const auto& r : warehouse) {
          std::string key = group_by == "region" ? r.region : r.product;
          bump(key, metric == "units" ? r.units : r.revenue);
        }
        std::sort(totals.begin(), totals.end(),
                  [](const auto& a, const auto& b) { return a.second > b.second; });
        axllm::Value ranked = axllm::Value::array();
        for (std::size_t i = 0; i < totals.size() && i < limit; ++i) {
          axllm::Core::append(ranked, axllm::object({
                                          {"key", totals[i].first},
                                          {"value", static_cast<double>(totals[i].second)},
                                      }));
        }
        return ranked;
      })
      .register_callable("trend", [&warehouse](axllm::Value p) -> axllm::Value {
        std::string region = axllm::display(axllm::Core::get(p, "region", ""));
        std::string product = axllm::display(axllm::Core::get(p, "product", ""));
        std::vector<long> series(12, 0);
        for (const auto& r : warehouse) {
          if (r.region == region && r.product == product) series[r.monthIndex] = r.revenue;
        }
        axllm::Value out = axllm::Value::array();
        for (long v : series) axllm::Core::append(out, static_cast<double>(v));
        return out;
      });

  auto analyst = axllm::agent(
      "schema:string, question:string -> answer:string, evidence:string[] \"Concrete figures the answer is based on\"",
      axllm::object({
          // Big data dictionary stays out of the prompt.
          {"contextFields", axllm::array({"schema"})},
          // Tool specs advertised to the model; handlers are registered on the runtime above.
          {"functions", axllm::array({
              axllm::object({
                  {"name", "query"},
                  {"description", "Filter the sales table and return aggregates for the matching rows."},
                  {"parameters", axllm::object({
                      {"type", "object"},
                      {"properties", axllm::object({
                          {"region", axllm::object({{"type", "string"}})},
                          {"product", axllm::object({{"type", "string"}})},
                          {"month", axllm::object({{"type", "string"}})},
                      })},
                  })},
              }),
              axllm::object({
                  {"name", "top"},
                  {"description", "Rank a metric (revenue|units) grouped by product|region, highest first."},
                  {"parameters", axllm::object({
                      {"type", "object"},
                      {"properties", axllm::object({
                          {"metric", axllm::object({{"type", "string"}})},
                          {"groupBy", axllm::object({{"type", "string"}})},
                          {"limit", axllm::object({{"type", "number"}})},
                      })},
                      {"required", axllm::array({"metric", "groupBy"})},
                  })},
              }),
              axllm::object({
                  {"name", "trend"},
                  {"description", "Monthly revenue series (Jan..Dec) for one region and product."},
                  {"parameters", axllm::object({
                      {"type", "object"},
                      {"properties", axllm::object({
                          {"region", axllm::object({{"type", "string"}})},
                          {"product", axllm::object({{"type", "string"}})},
                      })},
                      {"required", axllm::array({"region", "product"})},
                  })},
              }),
          })},
          {"contextPolicy", axllm::object({{"preset", "lean"}, {"budget", "balanced"}})},
          {"runtime", axllm::object({{"language", "JavaScript"}})},
      }));

  axllm::Value result = analyst.forward(
      client,
      axllm::object({
          {"schema", schema},
          {"question", "Which region+product had the strongest Jan->Dec revenue growth, and which products have an average return rate above the 5% review threshold?"},
      }),
      axllm::object({{"runtime", axllm::Core::code_runtime_ref(runtime)}, {"max_actor_steps", 40}}));

  std::cout << axllm::stringify(result) << "\n";
}
