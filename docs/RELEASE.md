# Ax Multi-Language Releases

Ax ships first as the TypeScript/JavaScript package `@ax-llm/ax`. The same
portable Ax semantics can also be emitted as generated Python, Java, C++, and
Go libraries. AxIR is the compiler implementation detail behind those libraries;
it is not a package name. The generated package sources are checked in under
`packages/python`, `packages/java`, `packages/cpp`, and `packages/go`.

## Package Names

- JavaScript/TypeScript: npm package `@ax-llm/ax`
- Python: PyPI distribution and import package `axllm`
- Java: Maven coordinate `dev.axllm:ax`, Java package `dev.axllm.ax`
- C++: CMake package `axllm`, target `axllm::axllm`, namespace `axllm`
- Go: module `github.com/ax-llm/ax/go`, package `axllm`

Do not publish generated packages as `axir`, `ax-go`, or other compiler/backend
names. User-facing libraries should read as Ax libraries in each ecosystem.

## Versioning

Generated package metadata uses the same version as the root `@ax-llm/ax`
package. Release automation may override this with `AX_PACKAGE_VERSION`; local
compiler runs fall back to the nearest `package.json` version and then to a
development fallback.

## Local Release Smoke

The default verification path remains dependency-light:

```bash
cd tools/axir
GOCACHE=/private/tmp/go-build go run . verify \
  --targets python,java,cpp,go \
  --workdir /private/tmp/axir-verify-release \
  ../../ir/axcore/root.axir
```

That gate emits the generated libraries and smoke-tests package consumption:

- Python source/install import of `axllm`, plus an installed-package example when
  build tooling is available
- Java base jar compile and example execution from the jar classpath
- C++ static library build, CMake configure/build/install, and a downstream
  `find_package(axllm CONFIG REQUIRED)` consumer linked to `axllm::axllm`

Optional QuickJS, Pyodide, and Go goja runtime profile checks stay opt-in and
are not base Python/Java/C++ package dependencies. Go's built-in JavaScript
actor runtime is dependency-bearing in the generated `runtime/goja` package and
is verified explicitly with:

```bash
cd tools/axir
GOCACHE=/private/tmp/go-build go run . verify \
  --targets go \
  --runtime-profiles javascript-goja \
  --workdir /private/tmp/axir-verify-goja \
  ../../ir/axcore/root.axir
```

Regenerate the checked-in package trees before release when AxIR changes:

```bash
npm run axir:generate-packages
npm run axir:check-packages
```

For local examples, use the shared runner from the repo root:

```bash
npm run example -- list
npm run example -- python agent_pipeline.py
npm run example -- java FlowProgramGraphExample.java
npm run example -- cpp realtime_audio_events.cpp
npm run example -- go signature_schema.go
npm run example -- python axgen_openai_api.py
npm run example -- java AxGenOpenAIExample.java
npm run example -- cpp axgen_openai_api.cpp
npm run example -- go axgen_openai_api.go
```

The runner loads `.env`, uses the committed package source under
`packages/<language>`, writes build scratch data under `src/examples/.generated/`,
and runs the checked-in example source. No-key examples use deterministic local
clients/transports and cover AxAgent, AxFlow, provider audio/realtime mapping,
runtime adapters, optimizer artifacts, and GEPA. Provider API examples call real
provider HTTP and require provider keys such as `OPENAI_API_KEY` or
`OPENAI_APIKEY`.

## Publishing Shape

Publishing is secret-gated per ecosystem:

- npm continues to publish `@ax-llm/ax` through the existing release flow.
- PyPI publishing should upload the generated `axllm` wheel/sdist with
  `PYPI_API_TOKEN`.
- Maven Central publishing should upload `dev.axllm:ax` with the configured
  Central credentials and signing setup.
- C++ should start as GitHub Release source/CMake artifacts. Conan or vcpkg can
  be added later if product demand justifies maintaining package-manager recipes.

The release gate should run `axir verify` and `npm run axir:check-packages`
before upload, and keep generated runtime-profile dependencies out of the base
Python, Java, and C++ packages. For Go, keep vendor-specific runtime
constructors in opt-in subpackages such as `runtime/goja` rather than in the
root `axllm` package.
