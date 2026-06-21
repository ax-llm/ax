// ax-example:start
// title: Rust Codebase Q&A with a Peek Context Map
// group: long-agents
// description: Answers several dependency questions over one large module index by building and reusing an evolving context map (the "peek" orientation cache), so later questions skip re-scanning the corpus.
// provider: google-gemini
// env: GOOGLE_APIKEY
// level: advanced
// order: 20
// ax-example:end
use axllm::runtime::quickjs::QuickJsCodeRuntime;
use axllm::{agent_with_options, AxResult, GoogleGeminiClient};
use serde_json::json;
use std::env;

fn gemini_client() -> AxResult<GoogleGeminiClient> {
    let api_key = env::var("GOOGLE_APIKEY")
        .map_err(|_| axllm::AxError::runtime("Set GOOGLE_APIKEY to run this example."))?;
    let model = env::var("AX_GEMINI_MODEL").unwrap_or_else(|_| "gemini-3.5-flash".to_string());
    Ok(GoogleGeminiClient::new(api_key, model).with_profile("google-gemini"))
}

struct Module {
    path: String,
    imports: Vec<&'static str>,
    writes: &'static str,
}

// ---------------------------------------------------------------------------
// A large module-dependency index for a monorepo. Each block is a record the
// agent must *search* to answer -- the answers cannot be guessed, only computed
// by filtering the index. Generated large so it would not fit comfortably in a
// prompt; it lives in contextFields and is queried from the runtime.
// ---------------------------------------------------------------------------
fn build_module_index() -> Vec<Module> {
    let mut modules: Vec<Module> = vec![
        Module { path: "packages/api/middleware/auth.ts".into(), imports: vec!["packages/shared"], writes: "-" },
        Module { path: "packages/api/middleware/rateLimit.ts".into(), imports: vec!["packages/db"], writes: "-" },
        Module { path: "packages/api/routes/checkout.ts".into(), imports: vec!["packages/api/middleware/auth.ts", "packages/services/orders/createOrder.ts", "packages/services/payments/charge.ts"], writes: "-" },
        Module { path: "packages/api/routes/search.ts".into(), imports: vec!["packages/api/middleware/auth.ts", "packages/services/catalog/searchCatalog.ts"], writes: "-" },
        Module { path: "packages/services/orders/createOrder.ts".into(), imports: vec!["packages/db", "packages/clients/bus"], writes: "orders" },
        Module { path: "packages/services/orders/orderRepo.ts".into(), imports: vec!["packages/db"], writes: "orders" },
        Module { path: "packages/services/payments/charge.ts".into(), imports: vec!["packages/clients/acquirer", "packages/db"], writes: "payments" },
        Module { path: "packages/services/payments/refund.ts".into(), imports: vec!["packages/clients/acquirer", "packages/db"], writes: "refunds" },
        Module { path: "packages/services/catalog/searchCatalog.ts".into(), imports: vec!["packages/db"], writes: "-" },
        Module { path: "packages/clients/acquirer/index.ts".into(), imports: vec!["packages/shared"], writes: "-" },
        Module { path: "packages/clients/bus/index.ts".into(), imports: vec!["packages/shared"], writes: "-" },
    ];
    // Filler modules so the index is genuinely large; some also depend on the acquirer.
    for i in 0..110 {
        let dep = if i % 4 == 0 { "packages/clients/acquirer" } else { "packages/db" };
        let writes = if i % 6 == 0 { "audit" } else { "-" };
        modules.push(Module {
            path: format!("packages/services/feature{}/handler.ts", i),
            imports: vec![dep, "packages/shared"],
            writes,
        });
    }
    modules
}

fn main() -> AxResult<()> {
    let mut client = gemini_client()?;

    let modules = build_module_index();
    let codebase_index = modules
        .iter()
        .map(|m| {
            format!(
                "PATH: {}\nIMPORTS: {}\nWRITES: {}",
                m.path,
                m.imports.join(", "),
                m.writes
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    println!(
        "Module index: {} records (kept out of the prompt).",
        modules.len()
    );

    // `with_runtime` attaches the embedded JS engine so the agent loop can run.
    let mut analyst = agent_with_options(
        "context:string, question:string -> answer:string, paths:string[] \"Exact PATH values from the index that answer the question\"",
        json!({
            "contextFields": ["context"],
            "contextPolicy": {"preset": "adaptive", "budget": "balanced"},
            "contextOptions": {
                "description": "The context is a module index of \"PATH / IMPORTS / WRITES\" records. Answer by filtering those records in code -- never guess. Return exact PATH values verbatim.",
            },
            // The Peek context map: small, persistent orientation reused across queries.
            "contextMap": {"maxChars": 1800, "infiniteEvolve": false, "evolveSteps": 1},
            "runtime": {"language": "JavaScript"},
        }),
    )?
    .with_runtime(Box::new(QuickJsCodeRuntime::new()))?;

    let questions = [
        "Which modules import 'packages/clients/acquirer'? Give the exact PATH values.",
        "Which modules write to the 'orders' table?",
        "What are the direct IMPORTS of packages/api/routes/checkout.ts?",
    ];

    for question in questions {
        let output = analyst.forward_with_options(
            &mut client,
            json!({"context": codebase_index, "question": question}),
            json!({"max_actor_steps": 24}),
        )?;
        let answer = output
            .get("answer")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let paths = output
            .get("paths")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .map(|p| p.as_str().map(String::from).unwrap_or_else(|| p.to_string()))
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .unwrap_or_default();
        println!("\nQ: {}", question);
        println!("A: {}", answer);
        println!("Paths: {}", paths);
    }

    println!("\nThe context map evolved on the first query and was reused for the rest.");
    Ok(())
}
