use axllm::{ax, flow, AxAIClient, AxError, AxGenDelta, AxResult};
use serde_json::{json, Map, Value};
use std::cell::RefCell;
use std::collections::VecDeque;
use std::rc::Rc;
use std::sync::{Arc, Mutex};

// Streams one scripted response per request, chunk by chunk, as a provider
// stream does; chat() answers with the same text in one response.
struct ScriptedStreamClient {
    responses: VecDeque<Vec<&'static str>>,
    requests: usize,
}

impl ScriptedStreamClient {
    fn new(responses: Vec<Vec<&'static str>>) -> Self {
        Self {
            responses: responses.into(),
            requests: 0,
        }
    }

    fn next_response(&mut self) -> AxResult<Vec<&'static str>> {
        self.requests += 1;
        self.responses
            .pop_front()
            .ok_or_else(|| AxError::runtime("no scripted response left"))
    }
}

impl AxAIClient for ScriptedStreamClient {
    fn chat(&mut self, _request: Value) -> AxResult<Value> {
        let text = self.next_response()?.concat();
        Ok(json!({"results": [{"index": 0, "content": text, "finish_reason": "stop"}]}))
    }

    fn stream(&mut self, _request: Value) -> AxResult<Vec<Value>> {
        let mut chunks: Vec<Value> = self
            .next_response()?
            .into_iter()
            .map(|content| json!({"results": [{"index": 0, "content": content}]}))
            .collect();
        chunks.push(json!({"results": [{"index": 0, "finish_reason": "stop"}]}));
        Ok(chunks)
    }
}

// Merges deltas as a consumer does: strings and arrays append, other values
// replace, and a new version starts the sample over.
#[derive(Default)]
struct Merged {
    version: i64,
    values: Map<String, Value>,
}

impl Merged {
    fn apply(&mut self, update: &AxGenDelta) {
        if update.version != self.version {
            self.version = update.version;
            self.values.clear();
        }
        for (field, value) in update.delta.as_object().into_iter().flatten() {
            match (self.values.get_mut(field), value) {
                (Some(Value::String(text)), Value::String(more)) => text.push_str(more),
                (Some(Value::Array(items)), Value::Array(more)) => {
                    items.extend(more.iter().cloned())
                }
                _ => {
                    self.values.insert(field.clone(), value.clone());
                }
            }
        }
    }
}

fn main() -> AxResult<()> {
    // A streaming assertion stops the first answer as it streams; the retry
    // starts version 1, so the consumer starts that sample over.
    let mut client = ScriptedStreamClient::new(vec![
        vec!["Answer: The cat ", "barks"],
        vec!["Answer: The cat ", "purrs"],
    ]);
    let mut program = ax("question:string -> answer:string")?;
    program.add_streaming_assert(
        "answer",
        |text, _done| {
            Ok(if text.contains("barks") {
                json!("Cats do not bark.")
            } else {
                Value::Null
            })
        },
        None,
    )?;
    let merged = Rc::new(RefCell::new(Merged::default()));
    let view = merged.clone();
    let output = program.streaming_forward(
        &mut client,
        json!({"question": "What does the cat do?"}),
        json!({}),
        move |update| {
            view.borrow_mut().apply(&update);
            Ok(())
        },
    )?;
    assert_eq!(output, json!({"answer": "The cat purrs"}));
    assert_eq!(merged.borrow().version, 1);
    assert_eq!(Value::Object(merged.borrow().values.clone()), output);
    assert_eq!(client.requests, 2);

    // A field processor's note goes back to the model for another step, as in
    // TypeScript; a streaming field processor sees the text as it streams.
    let mut client = ScriptedStreamClient::new(vec![
        vec![
            "Answer: Paris is the capital ",
            "and largest city of France.",
        ],
        vec!["Answer: Paris."],
    ]);
    let mut program = ax("question:string -> answer:string")?;
    program.add_field_processor("answer", |value, _context| {
        let words = value
            .as_str()
            .unwrap_or_default()
            .split_whitespace()
            .count();
        Ok((words > 3).then(|| json!(format!("That answer has {words} words; use at most 3."))))
    })?;
    let seen = Arc::new(Mutex::new(Vec::new()));
    let watcher = seen.clone();
    program.add_streaming_field_processor("answer", move |text, context| {
        watcher.lock().unwrap().push((
            text.as_str().unwrap_or_default().trim().to_string(),
            context.done,
        ));
        Ok(None)
    })?;
    let versions = Rc::new(RefCell::new(Vec::new()));
    let tracker = versions.clone();
    let output = program.streaming_forward(
        &mut client,
        json!({"question": "What is the capital of France?"}),
        json!({}),
        move |update| {
            tracker.borrow_mut().push(update.version);
            Ok(())
        },
    )?;
    assert_eq!(output, json!({"answer": "Paris."}));
    assert_eq!(client.requests, 2);
    assert_eq!(versions.borrow().last(), Some(&1));
    assert_eq!(
        seen.lock().unwrap().last().cloned(),
        Some(("Paris.".to_string(), true))
    );

    // Field transforms rewrite the final value; a streamed transformed field
    // is held back and sent once, transformed.
    let mut client = ScriptedStreamClient::new(vec![vec!["Answer: hello ", "world"]]);
    let mut program = ax("question:string -> answer:string")?
        .with_field_transform("answer", "uppercase")
        .with_field_transform_fn("answer", |value| {
            json!(format!("{}!", value.as_str().unwrap_or_default()))
        });
    let updates = Rc::new(RefCell::new(Vec::new()));
    let sink = updates.clone();
    let output = program.streaming_forward(
        &mut client,
        json!({"question": "Greet"}),
        json!({}),
        move |update| {
            sink.borrow_mut().push(update);
            Ok(())
        },
    )?;
    assert_eq!(output, json!({"answer": "HELLO WORLD!"}));
    assert_eq!(
        *updates.borrow(),
        vec![AxGenDelta {
            version: 0,
            index: 0,
            delta: output.clone()
        }]
    );

    // An error from the callback stops the run, and streaming_forward
    // returns that same error.
    let mut client = ScriptedStreamClient::new(vec![vec!["Answer: one ", "two ", "three"]]);
    let mut program = ax("question:string -> answer:string")?;
    let error = program
        .streaming_forward(
            &mut client,
            json!({"question": "Count"}),
            json!({}),
            |_update| Err(AxError::new("stopped", "seen enough")),
        )
        .unwrap_err();
    assert_eq!(error.category, "stopped");
    assert_eq!(client.requests, 1);

    // AxFlow streams its whole output as one update, as TypeScript does.
    let mut client = ScriptedStreamClient::new(vec![vec!["Answer: Paris"]]);
    let mut workflow = flow("example.streamFlow")
        .execute("qa", ax("question:string -> answer:string")?)
        .returns(json!({"answer": "answer"}));
    let updates = workflow.streaming_forward(
        &mut client,
        json!({"question": "Capital of France?"}),
        json!({}),
    )?;
    assert_eq!(
        updates,
        vec![AxGenDelta {
            version: 1,
            index: 0,
            delta: json!({"answer": "Paris"})
        }]
    );

    println!("rust-axgen-streaming-ok");
    Ok(())
}
