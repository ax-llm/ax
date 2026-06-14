// docs:start signature-schema
use axllm::{s, AxResult};

fn main() -> AxResult<()> {
    let sig = s("question:string -> answer:string")?;
    let schema = sig.to_json_schema("outputs");
    assert!(schema["properties"].get("answer").is_some());
    println!("rust-signature-schema-ok");
    Ok(())
}
// docs:end signature-schema
