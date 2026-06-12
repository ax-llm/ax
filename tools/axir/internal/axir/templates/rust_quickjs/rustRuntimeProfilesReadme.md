# Runtime Profiles

The Rust package keeps the base crate dependency-light and exposes embedded JavaScript actor execution as an opt-in Cargo feature.

- javascript-quickjs: embedded JavaScript actor code through rquickjs. Enable it with cargo features runtime-quickjs.
- ProcessCodeRuntime remains available for the shared AxCodeRuntime JSONL protocol.

Verify the embedded profile with:

    cargo run --example javascript_quickjs --features runtime-quickjs

or from the AxIR toolchain:

    tools/axir verify --targets rust --runtime-profiles javascript-quickjs
