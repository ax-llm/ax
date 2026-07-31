use axllm::{
    AxError, AxMCPOAuthOptions, AxMCPStreamableHTTPTransport, AxMCPTokenSet,
    AxMCPTransport, AxResult,
};
use axllm::mcp::AxMCPTokenStore;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::env;
use std::sync::{Arc, Mutex};

#[derive(Default)]
struct MemoryTokenStore(HashMap<String, AxMCPTokenSet>);
impl AxMCPTokenStore for MemoryTokenStore {
    fn get_token(&mut self, key: &str) -> AxResult<Option<AxMCPTokenSet>> { Ok(self.0.get(key).cloned()) }
    fn set_token(&mut self, key: &str, token: AxMCPTokenSet) -> AxResult<()> { self.0.insert(key.into(), token); Ok(()) }
    fn clear_token(&mut self, key: &str) -> AxResult<()> { self.0.remove(key); Ok(()) }
}

fn main() -> AxResult<()> {
    let endpoint = env::var("AX_MCP_ENDPOINT").expect("AX_MCP_ENDPOINT is required");
    let expected_error = env::var("AX_MCP_EXPECT_ERROR").unwrap_or_default();
    let protection = json!({"requireHttps":false,"allowLocalhost":true,"allowPrivateNetworks":true});
    let mut transport = AxMCPStreamableHTTPTransport::new(endpoint, json!({"ssrfProtection":protection}))?;
    transport.oauth = Some(AxMCPOAuthOptions {
        client_id: Some("ax-port-client".into()),
        redirect_uri: Some("http://localhost:8787/callback".into()),
        scopes: vec!["mcp:read".into()],
        on_auth_code: Some(Arc::new(|url| {
            let value: Value = reqwest::blocking::get(url).map_err(error)?.json().map_err(error)?;
            Ok(value.as_object().cloned().unwrap_or_default())
        })),
        token_store: Some(Arc::new(Mutex::new(MemoryTokenStore::default()))),
        ssrf_protection: protection,
        require_iss: true,
        ..Default::default()
    });
    let outcome = run(&mut transport);
    match (outcome, expected_error.is_empty()) {
        (Ok(()), true) => println!("AX_MCP_OAUTH_OK"),
        (Err(value), false) if value.to_string().to_lowercase().contains(&expected_error.to_lowercase()) => println!("AX_MCP_OAUTH_EXPECTED_ERROR"),
        (Err(value), _) => return Err(value),
        (Ok(()), false) => return Err(AxError::new("smoke", format!("expected {expected_error} error"))),
    }
    Ok(())
}

fn error(value: impl std::fmt::Display) -> AxError { AxError::new("smoke", value.to_string()) }

fn run(transport: &mut AxMCPStreamableHTTPTransport) -> AxResult<()> {
    for (id, method) in ["initialize", "tools/list"].into_iter().enumerate() {
        transport.send(json!({"jsonrpc":"2.0","id":id+1,"method":method,"params":{}}))?;
    }
    Ok(())
}
