# Ax Multi-Language Releases
<!-- cspell:words Pyodide quickjs -->

Ax ships first as the TypeScript/JavaScript package `@ax-llm/ax`. The same
portable Ax semantics can also be emitted as generated Python, Java, C++, Go,
and Rust libraries. AxIR is the compiler implementation detail behind those libraries;
it is not a package name. The generated package sources are checked in under
`packages/python`, `packages/java`, `packages/cpp`, `packages/go`, and
`packages/rust`.

## Package Names

- JavaScript/TypeScript: npm package `@ax-llm/ax`
- Python: PyPI distribution and import package `axllm`
- Java: Maven coordinate `dev.axllm:ax`, Java package `dev.axllm.ax`
- C++: CMake package `axllm`, target `axllm::axllm`, namespace `axllm`
- Go: module `github.com/ax-llm/ax/packages/go`, package `axllm`
- Rust: crate `axllm`

Do not publish generated packages as `axir`, `ax-go`, or other compiler/backend
names. User-facing libraries should read as Ax libraries in each ecosystem.

## Versioning

Generated package metadata uses the same version as the root `@ax-llm/ax`
package. Release automation may override this with `AX_PACKAGE_VERSION`; local
compiler runs fall back to the nearest `package.json` version and then to a
development fallback.

## Release Flow

`npm run release` is the normal TypeScript workspace release path. It runs the
workspace release steps and then the root `release-it --no-increment` step that
creates the final release commit, tag, and GitHub Release.

Generated package source is checked in under `packages/<language>`. Built
registry artifacts, such as Python wheels, source distributions, Rust cargo
outputs, and other upload bundles, are not checked in. GitHub Actions publish
from the tagged, committed package source; publish jobs should not generate new
package source after checking out the release tag.

When AxIR, language templates, package examples, or conformance fixtures change,
regenerate and check the generated package trees before the final release tag.
Because generated package metadata follows the root package version, the
regeneration must happen after the workspace version bump and before the root
release commit/tag.

## Maintainer How-To

For an ordinary TypeScript-only release, use the existing one-command flow:

```bash
npm run release
```

For an AxIR/generated-language release, expand the current root release script
into phases so the generated packages pick up the bumped root version:

```bash
npm run release --workspaces --if-present
npm run axir:generate-packages
npm run axir:check-packages
npm run axir:verify:release
npm exec -- release-it --no-increment
```

The first command is the existing workspace-version-bump phase from
`npm run release`. The final command is the existing root release phase. Keep
the regenerated `packages/*` changes in the same release commit/tag as the
TypeScript version bump.

## Local Release Smoke

For frequent local iteration, run the faster dev verifier first:

```bash
npm run axir:verify:dev
npm run axir:verify:dev -- --targets python
```

The dev verifier uses the cached AxIR binary, stable temp caches, parallel
target verification, examples, and conformance while skipping downstream
package-consumer smoke tests.

Before release, run the full release verifier:

```bash
npm run axir:verify:release
```

That release gate emits the generated libraries and smoke-tests package consumption:

- Python source/install import of `axllm`, plus an installed-package example when
  build tooling is available
- Java base jar compile and example execution from the jar classpath
- C++ static library build, CMake configure/build/install, and a downstream
  `find_package(axllm CONFIG REQUIRED)` consumer linked to `axllm::axllm`
- Go module build, examples, conformance, and downstream local-module consumer
- Rust `cargo fmt --check`, `cargo test --all-targets`, examples, conformance,
  and downstream local path-dependency consumer

Optional QuickJS, Pyodide, and Go goja runtime profile checks stay opt-in and
are not base Python/Java/C++ package dependencies. Rust keeps the process JSONL
runtime boundary in the base crate and verifies embedded QuickJS only when the
`runtime-quickjs` Cargo feature is requested. Go's built-in JavaScript actor
runtime is dependency-bearing in the generated `runtime/goja` package and is
verified explicitly with:

```bash
npm run axir -- verify \
  --mode release \
  --targets go \
  --runtime-profiles javascript-goja \
  --workdir /private/tmp/axir-verify-goja
```

The Rust embedded QuickJS profile is verified separately with:

```bash
npm run axir -- verify \
  --mode release \
  --targets rust \
  --runtime-profiles javascript-quickjs \
  --workdir /private/tmp/axir-verify-rust-quickjs
```

Regenerate the checked-in package trees before release when AxIR changes:

```bash
npm run axir:generate-packages
npm run axir:check-packages
```

For local examples, use the shared runner from the repo root:

```bash
npm run example -- list
npm run example -- list --json
npm run example -- python src/examples/python/generation/axgen-openai.py
npm run example -- java src/examples/java/flows/SequentialFlowExample.java
npm run example -- cpp src/examples/cpp/audio/speech_audio.cpp
npm run example -- go src/examples/go/optimization/axgen_optimization.go
npm run example -- rust src/examples/rust/generation/basic_generation.rs
```

The runner loads `.env`, uses the committed package source under
`packages/<language>`, writes build scratch data under `src/examples/.generated/`,
and runs the checked-in public example source. Public examples call real
providers and require keys such as `OPENAI_API_KEY` or `OPENAI_APIKEY`.
Internal generated package fixtures use deterministic local clients/transports
and cover AxAgent, AxFlow, provider audio/realtime mapping, runtime adapters,
optimizer artifacts, and GEPA.

## Publishing Shape

Publishing is secret-gated per ecosystem and runs from GitHub Actions after a
GitHub Release is published:

- `.github/workflows/npm-publish.yml` runs `npm run publish` for the npm
  workspaces with `NODE_AUTH_TOKEN`.
- `.github/workflows/package-publish.yml` separately publishes generated
  packages from the same release event.
- Current generated-package publishing covers Python/PyPI and Rust/crates.io.
  PyPI builds and uploads the generated `axllm` wheel and source distribution;
  Rust publishes the generated `axllm` crate.
- Java/Maven Central, C++ release artifacts/package-manager recipes, and Go
  module release handling are future publishing work unless added in a separate
  release change. Go consumers resolve the module from the git tag.

CI publishing uses GitHub secrets and trusted-publishing/OIDC where configured,
not `.env`. The repo `.env` is only for local example/provider runs and for any
future local helper script that explicitly loads it.

The release gate should run `axir verify` and `npm run axir:check-packages`
before upload. Keep generated runtime-profile dependencies out of the base
Python, Java, C++, and Rust packages. For Go, keep vendor-specific runtime
constructors in opt-in sub-packages such as `runtime/goja` rather than in the
root `axllm` package. For Rust, keep embedded runtime engines additive,
feature-gated, and behind the existing `AxCodeRuntime` / `AxCodeSession`
traits.
