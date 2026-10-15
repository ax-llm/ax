// ax-example:start
// title: Rust Jev Image Localization
// group: generation
// description: Locates a red square using image inputs and Box outputs with native confidence.
// provider: typesafe
// env: TYPESAFE_APIKEY
// level: intermediate
// order: 47
// ax-example:end
use axllm::{ai, ax, AxResult};
use serde_json::json;
use std::{env, fs};

// Standard-library base64 encoder for inline image data.
fn b64encode(input: &[u8]) -> String {
    const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in input.chunks(3) {
        let b0 = chunk[0];
        let b1 = *chunk.get(1).unwrap_or(&0);
        let b2 = *chunk.get(2).unwrap_or(&0);
        out.push(T[(b0 >> 2) as usize] as char);
        out.push(T[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char);
        out.push(if chunk.len() > 1 { T[(((b1 & 0x0f) << 2) | (b2 >> 6)) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { T[(b2 & 0x3f) as usize] as char } else { '=' });
    }
    out
}

fn main() -> AxResult<()> {
    let mut model = ai("typesafe", json!({"api_key":env::var("TYPESAFE_APIKEY").expect("Set TYPESAFE_APIKEY"), "model":"jev-1.14.0"}))?;
    let bytes = fs::read("src/examples/assets/decision-shapes.png").map_err(|error| axllm::AxError::runtime(error.to_string()))?;
    let result = ax("photo:image -> visible:boolean \"Is there a red square in photo?\", target:box(evidence) \"The red square in photo\"")?.forward(&mut model, json!({"photo":{"mimeType":"image/png", "data":b64encode(&bytes)}}))?;
    // Jev always returns a region; consume it only when the target is present.
    if result["visible"] == true { println!("{}", serde_json::to_string_pretty(&result["target"])?); }
    else { println!("The target was not detected."); }
    Ok(())
}
