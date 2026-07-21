// ax-example:start
// title: Rust Signature Constraints
// group: generation
// description: Builds native constrained fields and runs the signature with OpenAI.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 40
// ax-example:end
use axllm::{ax, f, AxResult, FieldType, OpenAICompatibleClient};
use serde_json::json;
use std::env;

fn openai_client() -> AxResult<OpenAICompatibleClient> {
    let api_key = env::var("OPENAI_API_KEY")
        .or_else(|_| env::var("OPENAI_APIKEY"))
        .map_err(|_| {
            axllm::AxError::runtime("Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.")
        })?;
    let model = env::var("AX_OPENAI_MODEL").unwrap_or_else(|_| "gpt-5.4-mini".to_string());
    Ok(OpenAICompatibleClient::new(api_key, model).with_model_config(json!({"temperature": 0})))
}

fn main() -> AxResult<()> {
    let mut request_type = FieldType::string();
    request_type.min_length = Some(10.0);
    request_type.max_length = Some(500.0);
    request_type.description = Some("Booking request".to_string());
    let mut email_type = FieldType::string();
    email_type.format = Some("email".to_string());
    email_type.description = Some("Contact email".to_string());
    let mut party_type = FieldType::number();
    party_type.minimum = Some(1.0);
    party_type.maximum = Some(12.0);
    party_type.description = Some("Guests".to_string());
    let mut code_type = FieldType::string();
    code_type.pattern = Some(r"^[A-Z]{3}-\d{4}$".to_string());
    code_type.pattern_description = Some("Must look like ABC-1234".to_string());

    let signature = f()
        .input("requestText", request_type)
        .input("contactEmail", email_type)
        .output("partySize", party_type)
        .output("bookingCode", code_type)
        .build();
    let mut program = ax("requestText:string -> partySize:number, bookingCode:string")?;
    program.signature = signature;
    let mut client = openai_client()?;
    let output = program.forward(
        &mut client,
        json!({
            "requestText": "Book dinner for four people under the name Ada Lovelace.",
            "contactEmail": "ada@example.com"
        }),
    )?;
    println!("{}", serde_json::to_string_pretty(&output)?);
    Ok(())
}
