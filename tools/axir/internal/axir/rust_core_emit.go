package axir

import (
	"fmt"
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
	for _, spec := range javaCoreFuncs {
		op, ok := model.Symbols[spec.Symbol]
		if !ok {
			return fmt.Errorf("missing Core function @%s", spec.Symbol)
		}
		if AttrString(op, "body_source") != "core" {
			return fmt.Errorf("Core function @%s is missing body_source=core", spec.Symbol)
		}
	}
	return nil
}
