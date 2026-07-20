use axllm::flow;

fn main() {
    let source = r#"flowchart TD
  %%ax classify: requestText:string -> route:class "support, sales"
  %%ax reply: requestText:string -> replyText:string(max 300)
  classify{route} -->|support| reply"#;
    let program = flow(source);
    let rendered = program.to_string();
    assert!(rendered.contains("%%ax reply: requestText:string -> replyText:string(max 300)"));
    assert!(rendered.contains("classify -->|support| reply"));
    assert_eq!(flow(&rendered).to_string(), rendered);
    println!("rust-flow-mermaid-ok");
}
