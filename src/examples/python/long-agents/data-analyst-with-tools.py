# ax-example:start
# title: Python Data Analyst (Large Context + Tools)
# group: long-agents
# description: Combines a large data dictionary held in contextFields with typed warehouse tools, so the agent answers business questions over a big dataset it never has to inline.
# provider: google-gemini
# env: GOOGLE_APIKEY
# level: advanced
# order: 30
# ax-example:end
import json
import os

from axllm import GoogleGeminiClient, agent
from axllm.runtime_quickjs import AxQuickJsCodeRuntime

api_key = os.getenv("GOOGLE_APIKEY")
if not api_key:
    raise SystemExit("Set GOOGLE_APIKEY to run this example.")

client = GoogleGeminiClient(api_key=api_key, model="gemini-3-flash-preview")

# ---------------------------------------------------------------------------
# The "warehouse": a few hundred rows that live in the host process and are
# reachable only through tools. The model never sees the rows -- it queries
# them. Deterministic so the example is reproducible.
# ---------------------------------------------------------------------------
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def build_warehouse():
    regions = ["North", "South", "East", "West", "Central", "NW", "NE", "SE"]
    products = ["Widget-A", "Widget-B", "Gadget-X", "Gadget-Y"]
    rows = []
    seed = 7

    def rand():
        nonlocal seed
        seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF
        return seed / 0x7FFFFFFF

    for region in regions:
        for product in products:
            trend = 90 if (product == "Gadget-X" and region == "East") else 25  # a planted winner
            for m in range(len(MONTHS)):
                units = round(400 + rand() * 1200 + m * trend)
                price = 60 if product.startswith("Gadget") else 38
                return_rate = round(0.01 + rand() * 0.05 + (0.03 if product == "Widget-B" else 0), 3)
                rows.append({
                    "region": region, "product": product, "monthIndex": m, "month": MONTHS[m],
                    "units": units, "revenue": units * price, "returnRate": return_rate,
                })
    return rows


warehouse = build_warehouse()

# The schema/data dictionary is large-ish and goes into contextFields so the
# agent orients on column meaning + business rules without the doc entering the prompt.
schema = """
TABLE sales (one row per region x product x month)

COLUMNS
  region       text   one of: North, South, East, West, Central, NW, NE, SE
  product      text   one of: Widget-A, Widget-B, Gadget-X, Gadget-Y
  month        text   Jan..Dec (calendar order; monthIndex 0..11)
  units        int    units sold that month
  revenue      int    integer dollars (units * unit price; Gadgets cost more)
  returnRate   float  fraction of units returned, 0..1

BUSINESS RULES
  - "Growth" = change in monthly revenue from Jan to Dec for a region+product.
  - A return rate above 0.05 (5%) is flagged for quality review.
  - Compare like-for-like: always group by region AND product, not either alone.

TOOLS AVAILABLE (call them, never invent figures)
  query  filter + aggregate a slice -> {matched, totalUnits, totalRevenue, avgReturnRate}
  top    rank a metric ("revenue"|"units") grouped by "product"|"region" -> [{key, value}]
  trend  monthly revenue series (Jan..Dec) for one region + product
""".strip()


# --- Host tool handlers over the warehouse (the model never sees the rows) ---
def query_tool(p):
    region, product, month = p.get("region"), p.get("product"), p.get("month")
    rows = [
        r for r in warehouse
        if (not region or r["region"] == region)
        and (not product or r["product"] == product)
        and (not month or r["month"] == month)
    ]
    total_units = sum(r["units"] for r in rows)
    total_revenue = sum(r["revenue"] for r in rows)
    avg_return = round(sum(r["returnRate"] for r in rows) / len(rows), 4) if rows else 0
    return {"matched": len(rows), "totalUnits": total_units, "totalRevenue": total_revenue, "avgReturnRate": avg_return}


def top_tool(p):
    metric, group_by, limit = p.get("metric", "revenue"), p.get("groupBy", "product"), p.get("limit", 5)
    totals = {}
    for r in warehouse:
        key = r["region"] if group_by == "region" else r["product"]
        totals[key] = totals.get(key, 0) + (r["units"] if metric == "units" else r["revenue"])
    ranked = sorted(({"key": k, "value": v} for k, v in totals.items()), key=lambda x: -x["value"])
    return ranked[:limit]


def trend_tool(p):
    region, product = p.get("region"), p.get("product")
    series = [0] * 12
    for r in warehouse:
        if r["region"] == region and r["product"] == product:
            series[r["monthIndex"]] = r["revenue"]
    return series


runtime = AxQuickJsCodeRuntime()
runtime.register_callable("query", query_tool)
runtime.register_callable("top", top_tool)
runtime.register_callable("trend", trend_tool)

analyst = agent(
    'schema:string, question:string -> answer:string, evidence:string[] "Concrete figures the answer is based on"',
    {
        # Big data dictionary stays out of the prompt.
        "contextFields": ["schema"],
        # Tool specs advertised to the model; handlers are registered on the runtime above.
        "functions": [
            {
                "name": "query",
                "description": "Filter the sales table and return aggregates for the matching rows.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "region": {"type": "string"},
                        "product": {"type": "string"},
                        "month": {"type": "string"},
                    },
                },
            },
            {
                "name": "top",
                "description": "Rank a metric (revenue|units) grouped by product|region, highest first.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "metric": {"type": "string"},
                        "groupBy": {"type": "string"},
                        "limit": {"type": "number"},
                    },
                    "required": ["metric", "groupBy"],
                },
            },
            {
                "name": "trend",
                "description": "Monthly revenue series (Jan..Dec) for one region and product.",
                "parameters": {
                    "type": "object",
                    "properties": {"region": {"type": "string"}, "product": {"type": "string"}},
                    "required": ["region", "product"],
                },
            },
        ],
        "contextPolicy": {"preset": "lean", "budget": "balanced"},
        "runtime": {"language": "JavaScript"},
    },
)

result = analyst.forward(
    client,
    {
        "schema": schema,
        "question": "Which region+product had the strongest Jan->Dec revenue growth, and which products have an average return rate above the 5% review threshold?",
    },
    {"runtime": runtime, "max_actor_steps": 16},
)

print(json.dumps(result, indent=2, sort_keys=True))
