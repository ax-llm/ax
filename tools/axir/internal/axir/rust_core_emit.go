package axir

import (
	"strings"
)

func BuildRustCore(model AxRuntimeModel) (string, error) {
	if err := validateRustCoreSymbols(model); err != nil {
		return "", err
	}
	body := "// Rust v1 exposes Core-owned behavior through the Rust-native wrappers above.\n"
	lib := strings.Replace(rustLib, "// AXIR_CORE_RUST_FUNCTIONS\n", body, 1)
	exports := "pub mod mcp;\npub use mcp::{AxMCPClient, AxMCPOAuthOptions, AxMCPStdioTransport, AxMCPStreamableHTTPTransport, AxMCPTokenSet, AxMCPTransport};\n"
	return strings.Replace(lib, "use reqwest::blocking::Client as HttpClient;\n", exports+"use reqwest::blocking::Client as HttpClient;\n", 1), nil
}

func validateRustCoreSymbols(model AxRuntimeModel) error {
	// Rust does not emit Core bodies yet; building the registry still
	// enforces routing, naming, and module-rank invariants for the target.
	_, err := BuildCoreFuncRegistry(model)
	return err
}
