use axllm::runtime::quickjs::QuickJsCodeRuntime;
use axllm::{agent, AxCodeRuntime, AxError, AxResult};
use serde_json::json;

fn main() -> AxResult<()> {
    let mut runtime = QuickJsCodeRuntime::new()
        .with_runtime_policy(json!({"timeoutMs": 100, "maxSnapshotBytes": 64}));
    runtime.register_callable("search", |params| {
        Ok(json!({"answer": format!("result for {}", params["query"].as_str().unwrap_or(""))}))
    })?;
    runtime.register_callable("badTool", |_params| {
        Err(AxError::runtime("bad tool failed"))
    })?;

    let mut runner = agent("question:string -> answer:string")?;
    let step = runner.test(
        &mut runtime,
        "answer = inputs.question; final({ answer })",
        json!({"question": "quickjs"}),
    )?;
    assert_eq!(step.payload["type"], "final");
    assert_eq!(step.payload["args"][0]["answer"], "quickjs");
    assert_eq!(runner.inspect_runtime()?["answer"], "quickjs");

    let snapshot = runner.export_session_state()?;
    assert_eq!(snapshot["bindings"]["answer"], "quickjs");
    runner.restore_session_state(json!({"bindings": {"answer": "patched"}}))?;
    assert_eq!(runner.inspect_runtime()?["answer"], "patched");

    let mut session = runtime.create_session(
        json!({
            "inputs": {"question": "host"},
            "marker": {"__ax_host_callable": true, "result": {"ok": true}}
        }),
        json!({"reservedNames": ["inputs", "final"]}),
    )?;
    assert_eq!(
        session
            .execute("askClarification('more?')", json!({}))?
            .payload["type"],
        "askClarification"
    );
    assert_eq!(
        session
            .execute("discover({topic: 'docs'})", json!({}))?
            .payload["kind"],
        "discover"
    );
    assert_eq!(
        session
            .execute("recall({query: 'state'})", json!({}))?
            .payload["kind"],
        "recall"
    );
    assert_eq!(
        session
            .execute("used('doc-1', 'needed')", json!({}))?
            .payload["kind"],
        "used"
    );
    assert_eq!(
        session.execute("reportSuccess('ok')", json!({}))?.payload["kind"],
        "status"
    );
    assert_eq!(
        session.execute("reportFailure('no')", json!({}))?.payload["kind"],
        "status"
    );
    assert_eq!(
        session
            .execute("guideAgent('try this')", json!({}))?
            .payload["type"],
        "guide_agent"
    );
    assert_eq!(
        session
            .execute("final(search({query: inputs.question}))", json!({}))?
            .payload["args"][0]["answer"],
        "result for host"
    );
    assert_eq!(
        session.execute("final(marker())", json!({}))?.payload["args"][0]["ok"],
        true
    );
    assert_eq!(
        session.execute("badTool({})", json!({}))?.payload["error_category"],
        "runtime"
    );
    assert_eq!(
        session
            .execute("throw new Error('boom')", json!({}))?
            .payload["error_category"],
        "runtime"
    );
    assert_eq!(
        session
            .execute("while (true) {}", json!({"timeoutMs": 1}))?
            .payload["error_category"],
        "timeout"
    );
    session.patch_globals(
        json!({"bindings": {"final": "blocked", "answer": "patched"}}),
        json!({}),
    )?;
    assert_ne!(session.inspect_globals(json!({}))?["final"], "blocked");
    assert_eq!(session.inspect_globals(json!({}))?["answer"], "patched");
    session.close()?;
    assert_eq!(
        session.execute("final({})", json!({}))?.payload["error_category"],
        "session_closed"
    );

    println!("rust-javascript-quickjs-profile-ok runtime-behavior-parity-ok");
    Ok(())
}
