# Ax Multi-Language Releases

Ax ships first as the TypeScript/JavaScript package `@ax-llm/ax`. The same
portable Ax semantics can also be emitted as generated Python, Java, and C++
libraries. AxIR is the compiler implementation detail behind those libraries;
it is not a package name.

## Package Names

- JavaScript/TypeScript: npm package `@ax-llm/ax`
- Python: PyPI distribution and import package `axllm`
- Java: Maven coordinate `dev.axllm:ax`, Java package `dev.axllm.ax`
- C++: CMake package `axllm`, target `axllm::axllm`, namespace `axllm`
- Go, future: module `github.com/ax-llm/ax/go`, package `axllm`

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
  --targets python,java,cpp \
  --workdir /private/tmp/axir-verify-release \
  ../../ir/axcore/root.axir
```

That gate emits the generated libraries and smoke-tests package consumption:

- Python source/install import of `axllm`, plus an installed-package example when
  build tooling is available
- Java base jar compile and example execution from the jar classpath
- C++ static library build, CMake configure/build/install, and a downstream
  `find_package(axllm CONFIG REQUIRED)` consumer linked to `axllm::axllm`

Optional QuickJS and Pyodide runtime profile checks stay opt-in and are not base
package dependencies.

For local examples, use the shared runner from the repo root:

```bash
npm run example -- list
npm run example -- python agent_pipeline.py
npm run example -- java FlowProgramGraphExample.java
npm run example -- cpp realtime_audio_events.cpp
npm run example -- python axgen_live_openai.py
npm run example -- java AxGenLiveOpenAIExample.java
npm run example -- cpp axgen_live_openai.cpp
```

The runner loads `.env`, generates the requested language package into
`src/examples/.generated/`, builds it when needed, and runs the checked-in
example source. No-key examples use deterministic local clients/transports and
cover AxAgent, AxFlow, provider audio/realtime mapping, runtime adapters,
optimizer artifacts, and GEPA. Live examples use real provider HTTP and require
provider keys such as `OPENAI_API_KEY` or `OPENAI_APIKEY`.

## Publishing Shape

Publishing is secret-gated per ecosystem:

- npm continues to publish `@ax-llm/ax` through the existing release flow.
- PyPI publishing should upload the generated `axllm` wheel/sdist with
  `PYPI_API_TOKEN`.
- Maven Central publishing should upload `dev.axllm:ax` with the configured
  Central credentials and signing setup.
- C++ should start as GitHub Release source/CMake artifacts. Conan or vcpkg can
  be added later if product demand justifies maintaining package-manager recipes.

The release gate should run `axir verify` before upload and keep generated
runtime-profile dependencies out of the base Python, Java, and C++ packages.
