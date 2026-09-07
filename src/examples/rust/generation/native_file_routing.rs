// ax-example:start
// title: Rust Native File Routing
// group: generation
// description: Summarizes a PDF through a provider router without replacing the native file with extracted text.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY, AX_PDF_BASE64
// level: intermediate
// order: 53
// ax-example:end
use axllm::{ai, ax, AxResult, ProviderRouter};
use serde_json::json;
use std::env;
fn main() -> AxResult<()> {
 let client=ai("openai",json!({"api_key":env::var("OPENAI_API_KEY").or_else(|_|env::var("OPENAI_APIKEY")).expect("Set OPENAI_API_KEY"),"model":"gpt-6-astra","model_config":{"thinkingTokenBudget":"low"}}))?;
 let mut router=ProviderRouter::new().with_provider("openai",client);
 let mut program=ax("document:file -> summary:string")?;
 let result=program.forward_with_options(&mut router,json!({"document":{"filename":"report.pdf","mimeType":"application/pdf","data":env::var("AX_PDF_BASE64").expect("Set AX_PDF_BASE64")}}),json!({"serviceTier":"standard"}))?;
 println!("{}",serde_json::to_string_pretty(&result)?);
 Ok(())
}
