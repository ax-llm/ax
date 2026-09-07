// ax-example:start
// title: Rust Concurrent Astra Flow
// group: flows
// description: Independent conversations overlap, retain their tool results, and receive scoped controls.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 13
// ax-example:end
use axllm::{ai, ax, flow, run_control, tool, AxForwardOptions, AxResult};
use serde_json::{json, Value};
use std::{collections::BTreeSet, env, sync::{Arc, Mutex, Condvar}, time::Duration};

fn main()->AxResult<()> {
    let key=env::var("OPENAI_API_KEY").or_else(|_|env::var("OPENAI_APIKEY")).expect("Set OPENAI_API_KEY or OPENAI_APIKEY.");
    let mut client=ai("openai",json!({"api_key":key,"model":"gpt-6-astra","model_config":{"thinkingTokenBudget":"low","max_tokens":4096}}))?;
    let control=run_control();let paths=Arc::new(Mutex::new(BTreeSet::new()));let applied=Arc::new(Mutex::new(Vec::<Value>::new()));
    let observed_paths=paths.clone();let observed_updates=applied.clone();
    control.on_event(move |event|{if event["type"]=="tool.started"{observed_paths.lock().unwrap().insert(event["path"].as_str().unwrap().to_owned());}if event["type"]=="applied"{observed_updates.lock().unwrap().push(event);}});
    let gate=Arc::new((Mutex::new(0usize),Condvar::new()));let steering=control.clone();
    let lookup=tool("lookup").description("Look up the exact reference once.").execution("background").handler(move |_|{
        let (mutex,ready)=&*gate;let mut calls=mutex.lock().unwrap();*calls+=1;assert!(*calls<=2,"Lookup was called more than once per node");
        if *calls==2{steering.steer("Include VERIFIED with the exact reference in your final answer.")?;steering.set_thinking_token_budget_at("medium","root/left")?;ready.notify_all();}
        let (calls,timeout)=ready.wait_timeout_while(calls,Duration::from_secs(45),|calls|*calls<2).unwrap();assert!(!timeout.timed_out()&&*calls==2,"Independent nodes did not overlap");Ok(json!("REF-42"))
    });
    let program=ax("question -> answer")?.with_tool(lookup);
    let mut workflow=flow("parallel").execute("left",program.clone()).execute("right",program).returns(json!({"left":"leftResult","right":"rightResult"}));
    let result=workflow.forward_with_options(&mut client,json!({"question":"Call lookup exactly once. If its result is pending, return a brief progress message without calling it again. Return the exact reference when its result arrives."}),AxForwardOptions::from(json!({"serviceTier":"standard","maxSteps":6})).with_control(control))?;
    assert_eq!(*paths.lock().unwrap(),BTreeSet::from(["root/left".to_owned(),"root/right".to_owned()]));assert_eq!(applied.lock().unwrap().len(),3);
    for node in ["left","right"]{let answer=result[node].to_string();assert!(answer.contains("REF-42")&&answer.contains("VERIFIED"),"Missing final result: {answer}");}
    println!("{}",json!({"result":result,"parallel_overlap":true,"applied_controls":*applied.lock().unwrap()}));Ok(())
}
