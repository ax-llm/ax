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

`npm run release` is the normal release preparation path. It verifies that
local `main` is clean and synchronized with `origin/main`, creates a
`codex/release-<version>` branch, runs the workspace version bumps, regenerates
the generated packages, creates the release commit, validates it, pushes the
branch, and opens a pull request. It intentionally does not tag, push directly
to `main`, or create a GitHub Release.

After the release pull request passes the required checks and is merged, the
`Publish merged release` workflow waits for the merge commit's main-branch
`Build and Test` run to succeed. It then verifies that the commit is a merged,
version-aligned release, pushes an annotated tag, creates the GitHub Release,
and explicitly dispatches the npm and generated-package publication workflows
at that exact tag. Explicit dispatch is required because GitHub does not start
new workflows for ordinary events created with a workflow's `GITHUB_TOKEN`.

`npm run release:publish -- <version>` remains the guarded recovery path. Run it
from a clean, synchronized `main` branch if the automatic workflow needs manual
recovery. It checks the requested tag directly on the remote, resolves the
matching release commit from protected `main` history even if newer commits have
landed, verifies its merged pull request and required checks, replaces any stale
local tag, pushes the annotated tag, and creates the GitHub Release. Unrelated
historical local tags do not need to be cleaned up first.

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

Prepare a patch release and open its protected-main pull request:

```bash
npm run release
```

Pass `minor`, `major`, or an exact stable version when needed:

```bash
npm run release -- minor
npm run release -- 25.0.0
```

Once the release pull request is merged, wait for `Publish merged release` and
both package publication workflows to pass. For manual recovery only, synchronize
`main` and publish the missed version:

```bash
git switch main
git pull --ff-only origin main
npm run release:publish -- 24.0.6
```

The recovery command also works after `main` has advanced to a newer release;
it finds the unique matching release commit in protected `main` history rather
than tagging the newer tip.

Never rerun `npm run release` to recover a rejected push. The preparation
command refuses to run from an unsynchronized or dirty branch, and the root
`release-it` configuration disables direct pushes, tags, and GitHub Releases.
Preserve any prepared release commit first, then land it through a pull request.

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

Publishing runs from GitHub Actions after a GitHub Release is published, with
manual dispatch available for retries and verification:

- `.github/workflows/npm-publish.yml` publishes the npm workspaces through npm
  trusted publishing with GitHub Actions OIDC and signed provenance.
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
