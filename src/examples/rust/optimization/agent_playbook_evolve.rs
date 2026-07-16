// ax-example:start
// title: Rust Agent Playbook — Learn And Verify
// group: optimization
// description: Attach a persistent playbook, add validated hidden citations and stage guidance, then mine a task set into playbook rules with a verification gate.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: advanced
// order: 42
// ax-example:end
use axllm::runtime::quickjs::QuickJsCodeRuntime;
use axllm::{agent_with_options, AxResult, OpenAICompatibleClient};
use serde_json::{json, Value};
use std::cell::RefCell;
use std::env;
use std::rc::Rc;

fn openai_client() -> AxResult<OpenAICompatibleClient> {
    let api_key = env::var("OPENAI_API_KEY")
        .or_else(|_| env::var("OPENAI_APIKEY"))
        .map_err(|_| {
            axllm::AxError::runtime("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.")
        })?;
    let model = env::var("AX_OPENAI_MODEL").unwrap_or_else(|_| "gpt-5.4-mini".to_string());
    Ok(OpenAICompatibleClient::new(api_key, model))
}

fn main() -> AxResult<()> {
    let seed = json!({
        "playbook": {
            "version": 1,
            "sections": {
                "failures_to_avoid": [{
                    "id": "failures-to-avoid-00001",
                    "section": "failures_to_avoid",
                    "content": "Check the available evidence before answering.",
                    "helpfulCount": 0,
                    "harmfulCount": 0,
                    "createdAt": "2026-07-15T00:00:00.000Z",
                    "updatedAt": "2026-07-15T00:00:00.000Z"
                }]
            },
            "updatedAt": "2026-07-15T00:00:00.000Z"
        },
        "artifact": {"feedback": [], "history": []}
    });

    let observed_citations = Rc::new(RefCell::new(Value::Array(Vec::new())));
    let playbook_updates = Rc::new(RefCell::new(Vec::<Value>::new()));
    let mut assistant = agent_with_options(
        "question:string -> answer:string",
        json!({
            "contextFields": [],
            "runtime": {"language": "JavaScript"},
            "playbook": {"seed": seed},
            "citations": {"surface": "hidden"}
        }),
    )?
    .with_runtime(Box::new(QuickJsCodeRuntime::new()))?;
    assistant
        .set_instruction("Answer from evidence and state uncertainty plainly.")?
        .add_actor_instruction(
            "Before finishing, verify the answer against the collected evidence.",
        )?;
    let citation_sink = observed_citations.clone();
    assistant.set_citations_observer(move |value| *citation_sink.borrow_mut() = value);
    let playbook_sink = playbook_updates.clone();
    assistant.set_playbook_observer(move |value| playbook_sink.borrow_mut().push(value));

    let student = Rc::new(RefCell::new(openai_client()?));
    let answer = {
        let mut client = student.borrow_mut();
        assistant.forward_with_options(
            &mut *client,
            json!({"question": "What should a support agent verify before answering?"}),
            json!({"max_actor_steps": 8}),
        )?
    };

    let mut playbook = assistant.playbook(
        student.clone(),
        None::<Rc<RefCell<OpenAICompatibleClient>>>,
        json!({}),
    )?;
    let dataset = json!({
        "train": [{
            "input": {"question": "Give a concise evidence-first answer."},
            "score": 0
        }]
    });
    let evolution = {
        let mut client = student.borrow_mut();
        playbook.evolve_agent(
            &mut assistant,
            &mut *client,
            &dataset,
            &json!({"verify": true, "maxProposals": 1}),
        )?
    };

    println!("{}", serde_json::to_string_pretty(&answer)?);
    println!("citations: {}", observed_citations.borrow());
    println!("run-end updates: {}", playbook_updates.borrow().len());
    println!("outcomes: {}", evolution["outcomes"]);
    println!("{}", playbook.render());
    Ok(())
}
