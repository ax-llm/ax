#!/usr/bin/env node

// The fast tools/axir Go tests, for CI on every change: the static checks of
// the IR, the templates, the fixtures and the public surface, which take a
// second or less each, and the Python module audit (about 30 seconds). The
// slow ones (compiling and running every port, provenance audits) stay in
// `npm run test:axir`; CI covers most of that through its own AxIR jobs.
//
// A listed test that no longer exists fails the run, so a rename cannot drop
// a test from CI silently.

import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const axirDir = path.join(repoRoot, 'tools', 'axir');

export const FAST_GO_TESTS = [
  // The IR: parsing, formatting, checking, lowering and the core registry.
  'TestLoadCheckLowerAxCore',
  'TestBuildRuntimeModel',
  'TestCoreBodyParseFormatRoundTrip',
  'TestCompactIfWithoutElseRoundTrip',
  'TestCompactCoreBodyParseFormatRoundTrip',
  'TestCheckerDiagnostics',
  'TestCoreBodyCheckerDiagnostics',
  'TestCheckTypesDiagnostics',
  'TestCheckTypeUsageDiagnostics',
  'TestDumpJSON',
  'TestExplainSymbol',
  'TestLintLLMCoreProfile',
  'TestParseSignatureStringShapes',
  'TestParseSignatureStringRejects',
  'TestParseFieldsStringShapes',
  'TestTypeExprNamedTypes',
  'TestFileArgLoadSubstitutesContent',
  'TestFileArgFormatRoundTrip',
  'TestFileArgMissingFileErrors',
  'TestFileArgInvalidJSONErrors',
  'TestFormatRoundTripKeepsQuotedAtAndPercentStrings',
  'TestFormatValuePrintsOnlyRefTokensBare',
  'TestFormatAxCoreModulesReachFixedPoint',
  'TestEmittersCompileQuotedPercentStringsAsLiterals',
  'TestCheckersReadQuotedStringsAsLiterals',
  'TestCoreFuncRegistryFromAxCore',
  'TestCoreFuncRegistryRejectsMissingEmitModule',
  'TestCoreFuncRegistryRejectsUnknownModule',
  'TestCoreFuncRegistryRejectsNativeNameCollision',
  'TestCoreFuncRegistryRejectsRankViolation',
  'TestMustInject',
  'TestAuditProvenanceCatchesBrokenRegion',
  'TestParseCoverageTraceDedupes',
  'TestAuditCoverageDiffsAgainstRegistry',
  'TestCoverageAsymmetries',
  // Cross-language parity of the templates and the runners.
  'TestAgentCrossLanguageParity',
  'TestFlowMermaidCrossLanguageParity',
  'TestNumberFormatCrossLanguageParity',
  'TestDateFieldValueCrossLanguageParity',
  'TestAgentPublicAPIParity',
  'TestG4AgentCapabilityBackedByRealRunner',
  'TestActorRuntimeSurfacesAsyncRejections',
  'TestGeneratedRuntimePlaceholderDetectorRejectsDefaultBodies',
  'TestGeneratedConformanceRunnerAuditRejectsPlaceholderCoverage',
  'TestRLMStagesSymmetric',
  'TestStructuredOutputCapabilityAndShapeMatrix',
  'TestRealEngineFixturesRunCode',
  'TestLoneSurrogateFixturesHaveARunner',
  // The conformance fixtures and their extractors.
  'TestPromptConformanceFixturesLoad',
  'TestAxAgentConformanceFixturesLoad',
  'TestAxOptimizeConformanceFixturesLoad',
  'TestSignatureSchemaValidationConformanceFixturesLoad',
  'TestFlowGoldensExtractorUsesTSReference',
  'TestVerifyResolvesRelativeRootAgainstWorkingDirectory',
  'TestRequireConformanceFixturesFailsWhenNoneRan',
  'TestConformanceShardsCoverEveryFixtureOnce',
  'TestConformanceShardsRejectMissingResults',
  'TestConformanceShardsPropagateFailureAndWait',
  'TestConformanceWorkerSettings',
  'TestVerifyQuickJSProfileCanAutoDrivePythonThroughJavaServer',
  'TestVerifyGojaProfileIsGoNative',
  // Docs, examples and the public surface (README, docs, examples, scripts,
  // tools/axir and the generated packages).
  'TestPublicGeneratedSurfaceHygiene',
  'TestDocsCoverCompilerAndArchitecture',
  'TestAxAgentMemorySkillExamplesStayAligned',
  // Generated Python: every module defines or imports the helpers it calls.
  'TestPythonModuleMissingHelpers',
  'TestBuildPythonCoreModuleRejectsMissingHelper',
  'TestPythonModulesSelfContained',
];

// Listed tests that fail on main for a known reason, with that reason. Their
// failure is reported but does not fail the run; remove an entry once its
// fix lands.
export const KNOWN_FAILING = {};

// Reads `go test -json` output: each listed test's result and time.
export function summarizeGoTestJson(text, tests) {
  const results = new Map();
  const output = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim().startsWith('{')) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    // Subtests report under their parent.
    if (!event.Test || event.Test.includes('/')) continue;
    if (event.Action === 'output') {
      output.set(event.Test, (output.get(event.Test) ?? '') + event.Output);
    } else if (['pass', 'fail', 'skip'].includes(event.Action)) {
      results.set(event.Test, {
        action: event.Action,
        elapsed: event.Elapsed ?? 0,
      });
    }
  }
  return tests.map((name) => ({
    name,
    ...(results.get(name) ?? { action: 'missing', elapsed: 0 }),
    output: output.get(name) ?? '',
  }));
}

// Which results fail the run: a failed, skipped or missing test, unless it
// is a known failure.
export function failingResults(summary, knownFailing = KNOWN_FAILING) {
  return summary.filter(
    (result) => result.action !== 'pass' && !(result.name in knownFailing)
  );
}

function main() {
  const env = {
    ...process.env,
    GOCACHE: process.env.GOCACHE || path.join(tmpdir(), 'go-build'),
  };
  mkdirSync(env.GOCACHE, { recursive: true });
  // The model keys and endpoints of the environment are not the tests'.
  for (const name of Object.keys(env)) {
    if (name.endsWith('_BASE_URL')) delete env[name];
  }
  const pattern = `^(${FAST_GO_TESTS.join('|')})$`;
  const started = Date.now();
  const result = spawnSync(
    'go',
    [
      'test',
      '-count=1',
      '-json',
      '-timeout=10m',
      '-run',
      pattern,
      './internal/axir',
    ],
    {
      cwd: axirDir,
      env,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    }
  );
  if (result.error) throw result.error;
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const summary = summarizeGoTestJson(result.stdout ?? '', FAST_GO_TESTS);
  if (summary.every((entry) => entry.action === 'missing')) {
    // Nothing ran: the package did not build.
    process.stderr.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    console.error(
      `fast AxIR Go tests did not run (go test exit ${result.status})`
    );
    process.exit(result.status || 1);
  }
  for (const entry of summary) {
    const note =
      entry.name in KNOWN_FAILING && entry.action !== 'pass'
        ? ` (known failure: ${KNOWN_FAILING[entry.name]})`
        : '';
    console.log(
      `${entry.action.padEnd(7)} ${entry.elapsed.toFixed(2).padStart(6)}s  ${entry.name}${note}`
    );
  }
  for (const name of Object.keys(KNOWN_FAILING)) {
    const entry = summary.find((item) => item.name === name);
    if (entry?.action === 'pass') {
      const message = `${name} passes now: remove it from KNOWN_FAILING in scripts/test-axir-go-fast.mjs`;
      console.log(process.env.CI ? `::warning::${message}` : message);
    }
  }
  const failures = failingResults(summary);
  for (const failure of failures) {
    console.error(`\n--- ${failure.action.toUpperCase()}: ${failure.name}`);
    if (failure.action === 'missing') {
      console.error(
        'the test did not run: it was renamed or removed, or the run stopped before it'
      );
    }
    process.stderr.write(failure.output);
  }
  console.log(
    `\n${summary.length} fast AxIR Go tests in ${seconds}s (go test exit ${result.status}); ${failures.length} failing`
  );
  if (failures.length > 0) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
