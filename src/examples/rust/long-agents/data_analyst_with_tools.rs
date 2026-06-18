// ax-example:start
// title: Rust Data Analyst (Large Context + Tools)
// group: long-agents
// description: Combines a large data dictionary held in contextFields with typed warehouse tools, so the agent answers business questions over a big dataset it never has to inline.
// provider: google-gemini
// env: GOOGLE_APIKEY
// level: advanced
// order: 30
// ax-example:end
use axllm::runtime::quickjs::QuickJsCodeRuntime;
use axllm::{agent_with_options, AxResult, GoogleGeminiClient};
use serde_json::{json, Value};
use std::env;
use std::sync::Arc;

fn gemini_client() -> AxResult<GoogleGeminiClient> {
    let api_key = env::var("GOOGLE_APIKEY")
        .map_err(|_| axllm::AxError::runtime("Set GOOGLE_APIKEY to run this example."))?;
    let model = env::var("AX_GEMINI_MODEL").unwrap_or_else(|_| "gemini-3-flash-preview".to_string());
    Ok(GoogleGeminiClient::new(api_key, model).with_profile("google-gemini"))
}

const MONTHS: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

#[derive(Clone)]
struct Row {
    region: String,
    product: String,
    month_index: usize,
    month: String,
    units: i64,
    revenue: i64,
    return_rate: f64,
}

// ---------------------------------------------------------------------------
// The "warehouse": a few hundred rows that live in the host process and are
// reachable only through tools. The model never sees the rows -- it queries
// them. Deterministic so the example is reproducible.
// ---------------------------------------------------------------------------
fn build_warehouse() -> Vec<Row> {
    let regions = [
        "North", "South", "East", "West", "Central", "NW", "NE", "SE",
    ];
    let products = ["Widget-A", "Widget-B", "Gadget-X", "Gadget-Y"];
    let mut rows: Vec<Row> = Vec::new();
    let mut seed: i64 = 7;
    let mut rand = || {
        seed = (seed.wrapping_mul(1103515245).wrapping_add(12345)) & 0x7FFF_FFFF;
        seed as f64 / 0x7FFF_FFFF as f64
    };

    for region in regions {
        for product in products {
            // A planted winner: East + Gadget-X grows far faster than the rest.
            let trend = if product == "Gadget-X" && region == "East" {
                90.0
            } else {
                25.0
            };
            for (m, month) in MONTHS.iter().enumerate() {
                let units = (400.0 + rand() * 1200.0 + m as f64 * trend).round() as i64;
                let price = if product.starts_with("Gadget") { 60 } else { 38 };
                let return_rate = round3(
                    0.01 + rand() * 0.05 + if product == "Widget-B" { 0.03 } else { 0.0 },
                );
                rows.push(Row {
                    region: region.to_string(),
                    product: product.to_string(),
                    month_index: m,
                    month: month.to_string(),
                    units,
                    revenue: units * price,
                    return_rate,
                });
            }
        }
    }
    rows
}

fn round3(value: f64) -> f64 {
    (value * 1000.0).round() / 1000.0
}

fn round4(value: f64) -> f64 {
    (value * 10000.0).round() / 10000.0
}

fn opt_str(p: &Value, key: &str) -> Option<String> {
    p.get(key)
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from)
}

fn main() -> AxResult<()> {
    let mut client = gemini_client()?;

    let warehouse = Arc::new(build_warehouse());
    println!(
        "Warehouse rows: {} (kept out of the prompt).",
        warehouse.len()
    );

    // The schema/data dictionary is large-ish and goes into contextFields so the
    // agent orients on column meaning + business rules without the doc entering the prompt.
    let schema = r#"TABLE sales (one row per region x product x month)

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
  trend  monthly revenue series (Jan..Dec) for one region + product"#;

    // --- Host tool handlers over the warehouse (the model never sees the rows) ---
    let mut runtime = QuickJsCodeRuntime::new();

    let wh = warehouse.clone();
    runtime.register_callable("query", move |p: Value| {
        let region = opt_str(&p, "region");
        let product = opt_str(&p, "product");
        let month = opt_str(&p, "month");
        let rows: Vec<&Row> = wh
            .iter()
            .filter(|r| {
                region.as_deref().is_none_or(|v| r.region == v)
                    && product.as_deref().is_none_or(|v| r.product == v)
                    && month.as_deref().is_none_or(|v| r.month == v)
            })
            .collect();
        let total_units: i64 = rows.iter().map(|r| r.units).sum();
        let total_revenue: i64 = rows.iter().map(|r| r.revenue).sum();
        let avg_return = if rows.is_empty() {
            0.0
        } else {
            round4(rows.iter().map(|r| r.return_rate).sum::<f64>() / rows.len() as f64)
        };
        Ok(json!({
            "matched": rows.len(),
            "totalUnits": total_units,
            "totalRevenue": total_revenue,
            "avgReturnRate": avg_return,
        }))
    })?;

    let wh = warehouse.clone();
    runtime.register_callable("top", move |p: Value| {
        let metric = opt_str(&p, "metric").unwrap_or_else(|| "revenue".to_string());
        let group_by = opt_str(&p, "groupBy").unwrap_or_else(|| "product".to_string());
        let limit = p.get("limit").and_then(|v| v.as_u64()).unwrap_or(5) as usize;
        let mut totals: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
        for r in wh.iter() {
            let key = if group_by == "region" {
                r.region.clone()
            } else {
                r.product.clone()
            };
            let value = if metric == "units" { r.units } else { r.revenue };
            *totals.entry(key).or_insert(0) += value;
        }
        let mut ranked: Vec<(String, i64)> = totals.into_iter().collect();
        ranked.sort_by(|a, b| b.1.cmp(&a.1));
        let out: Vec<Value> = ranked
            .into_iter()
            .take(limit)
            .map(|(key, value)| json!({"key": key, "value": value}))
            .collect();
        Ok(Value::Array(out))
    })?;

    let wh = warehouse.clone();
    runtime.register_callable("trend", move |p: Value| {
        let region = opt_str(&p, "region").unwrap_or_default();
        let product = opt_str(&p, "product").unwrap_or_default();
        let mut series = [0i64; 12];
        for r in wh.iter() {
            if r.region == region && r.product == product {
                series[r.month_index] = r.revenue;
            }
        }
        Ok(json!(series.to_vec()))
    })?;

    // `with_runtime` attaches the embedded JS engine (with the tools above) so
    // the agent loop can run and call them.
    let mut analyst = agent_with_options(
        "schema:string, question:string -> answer:string, evidence:string[] \"Concrete figures the answer is based on\"",
        json!({
            // Big data dictionary stays out of the prompt.
            "contextFields": ["schema"],
            // Tool specs advertised to the model; handlers are registered on the runtime above.
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
        }),
    )?
    .with_runtime(Box::new(runtime))?;

    let result = analyst.forward_with_options(
        &mut client,
        json!({
            "schema": schema,
            "question": "Which region+product had the strongest Jan->Dec revenue growth, and which products have an average return rate above the 5% review threshold?",
        }),
        json!({"max_actor_steps": 16}),
    )?;

    println!("{}", serde_json::to_string_pretty(&result)?);
    Ok(())
}
