package axir

func BuildRustCore(model AxRuntimeModel) (string, error) {
	if err := validateRustCoreSymbols(model); err != nil {
		return "", err
	}
	body := "// Rust v1 exposes Core-owned behavior through the Rust-native wrappers above.\n"
	return mustInject(rustLib, "// AXIR_CORE_RUST_FUNCTIONS\n", body, "rustLib")
}

func validateRustCoreSymbols(model AxRuntimeModel) error {
	// Rust does not emit Core bodies yet; building the registry still
	// enforces routing, naming, and module-rank invariants for the target.
	_, err := BuildCoreFuncRegistry(model)
	return err
}
