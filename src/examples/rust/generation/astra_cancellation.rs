// ax-example:start
// title: Rust Cancel Background Work
// group: generation
// description: Cancels a live Astra run through the high-level controller and observes cooperative tool cancellation.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 13
// ax-example:end
use axllm::{ai,ax,tool,run_control,AxForwardOptions,AxResult};
use serde_json::json;
use std::{env,sync::{Arc,Mutex,atomic::{AtomicBool,Ordering}},time::{Instant,Duration}};
fn main()->AxResult<()> {
 let key=env::var("OPENAI_API_KEY").or_else(|_|env::var("OPENAI_APIKEY")).expect("Set OPENAI_API_KEY or OPENAI_APIKEY.");
 let control=run_control();let abort=control.clone();let settled=Arc::new(AtomicBool::new(false));let done=settled.clone();let started=Arc::new(Mutex::new(None));let clock=started.clone();
 let lookup=tool("lookup").description("Look up the reference.").execution("background").context_handler(move |_,context|{*clock.lock().unwrap()=Some((Instant::now(),context.call_id.clone()));abort.abort();let now=Instant::now();while !context.is_cancelled()&&now.elapsed()<Duration::from_secs(2){std::thread::sleep(Duration::from_millis(1));}assert!(context.is_cancelled(),"Tool missed cancellation");done.store(true,Ordering::SeqCst);Ok(json!("LATE: discard this result"))});
 let mut program=ax("question -> answer")?.with_tool(lookup);
 let mut client=ai("openai",json!({"api_key":key,"model":"gpt-6-astra","model_config":{"thinkingTokenBudget":"low","max_tokens":2048}}))?;
 let error=program.forward_with_options(&mut client,json!({"question":"Call lookup once and return its result."}),AxForwardOptions::from(json!({"serviceTier":"standard"})).with_control(control)).expect_err("Cancelled run returned success");
 let (start,id)=started.lock().unwrap().clone().expect("Tool did not start");let elapsed=start.elapsed();assert!(elapsed<Duration::from_secs(2));assert!(error.to_string().contains(&id.expect("Missing call ID")),"{error}");let deadline=Instant::now();while !settled.load(Ordering::SeqCst)&&deadline.elapsed()<Duration::from_secs(2){std::thread::sleep(Duration::from_millis(1));}assert!(settled.load(Ordering::SeqCst));println!("Cancelled in {elapsed:?}; {error}");Ok(())
}
