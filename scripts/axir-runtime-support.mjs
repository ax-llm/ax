#!/usr/bin/env node
// Generates the JavaScript every port's JS code runtime loads next to its
// bootstrap (tools/axir/internal/axir/templates/runtime/runtimeSupport.js):
//
// - __ax_analyze_code(code): TypeScript's action-log code analysis
//   (src/ax/util/jsAnalysis.ts, transpiled, plus the helpers
//   src/ax/agent/contextManager.ts builds on it): the top-level variables a
//   turn writes, the ones it reads, and the qualified calls it makes. The
//   agent derives each live variable's provenance from them, as TS's
//   buildRuntimeStateProvenance does.
// - __ax_inspect_entries(skipNames): TypeScript's AxJSRuntime snapshot
//   entries (src/ax/funcs/worker.runtime.ts _buildStructuredGlobalsSnapshot):
//   each user global's type, constructor, size, preview and restorability.
//
//   node scripts/axir-runtime-support.mjs write   # regenerate
//   node scripts/axir-runtime-support.mjs check   # fail when stale
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { transformSync } from 'esbuild';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const outPath = path.join(
  repoRoot,
  'tools/axir/internal/axir/templates/runtime/runtimeSupport.js'
);

// src/ax/agent/contextManager.ts: JS_KEYWORDS, extractReferencedIdentifiers,
// extractReadIdentifiers and extractDirectQualifiedCallableUsages.
const CONTEXT_MANAGER_HELPERS = `
const JS_KEYWORDS = new Set([
  'var', 'let', 'const', 'function', 'return', 'if', 'else', 'for', 'while',
  'do', 'switch', 'case', 'break', 'continue', 'try', 'catch', 'finally',
  'throw', 'new', 'delete', 'typeof', 'void', 'in', 'of', 'instanceof',
  'this', 'class', 'extends', 'super', 'import', 'export', 'default', 'from',
  'as', 'async', 'await', 'yield', 'true', 'false', 'null', 'undefined',
  'console', 'log'
]);
function extractReferencedIdentifiers(code) {
  const sanitized = stripJsStringsAndComments(code);
  const identRegex = /\\b([a-zA-Z_$][a-zA-Z0-9_$]*)\\b/g;
  const ids = new Set();
  let match = identRegex.exec(sanitized);
  while (match !== null) {
    if (match[1] && !JS_KEYWORDS.has(match[1])) {
      ids.add(match[1]);
    }
    match = identRegex.exec(sanitized);
  }
  return ids;
}
function extractReadIdentifiers(code) {
  const reads = extractReferencedIdentifiers(code);
  for (const declared of extractTopLevelDeclaredNames(code)) {
    reads.delete(declared);
  }
  return reads;
}
function extractDirectQualifiedCallableUsages(code) {
  const sanitized = stripJsStringsAndComments(code);
  const usages = new Set();
  const callPattern = /\\b([a-zA-Z_$][a-zA-Z0-9_$]*)\\.([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*\\(/g;
  let match = callPattern.exec(sanitized);
  while (match) {
    const namespace = match[1];
    const name = match[2];
    if (namespace && name) {
      usages.add(namespace + '.' + name);
    }
    match = callPattern.exec(sanitized);
  }
  return [...usages];
}
`;

// src/ax/funcs/worker.runtime.ts: the snapshot entry helpers. Engines without
// structuredClone decide restorability with a structured-clone check of their
// own: functions and symbols, anywhere in the value, are not restorable.
const INSPECT_HELPERS = `
const truncateInspectText = (text, maxChars) =>
  text.length <= maxChars ? text : text.slice(0, maxChars - 3) + '...';
const previewInspectAtom = (value) => {
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    return 'undefined';
  }
  const valueType = typeof value;
  if (typeof value === 'string') {
    return JSON.stringify(truncateInspectText(value, 40));
  }
  if (valueType === 'number' || valueType === 'boolean' || valueType === 'bigint') {
    return String(value);
  }
  if (valueType === 'symbol') {
    return String(value);
  }
  if (valueType === 'function') {
    const fnName = value.name && typeof value.name === 'string' ? value.name : '';
    return '[function ' + (fnName || 'anonymous') + ']';
  }
  if (Array.isArray(value)) {
    return '[array(' + value.length + ')]';
  }
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : String(value);
  }
  if (value instanceof Error) {
    return (value.name || 'Error') + ': ' + (value.message || '');
  }
  if (typeof Map !== 'undefined' && value instanceof Map) {
    return '[map(' + value.size + ')]';
  }
  if (typeof Set !== 'undefined' && value instanceof Set) {
    return '[set(' + value.size + ')]';
  }
  const ctorName =
    value && typeof value === 'object' && 'constructor' in value && value.constructor &&
    typeof value.constructor.name === 'string'
      ? value.constructor.name
      : '';
  return ctorName && ctorName !== 'Object' ? '[' + ctorName + ']' : '[object]';
};
const describeInspectType = (value) => {
  if (value === null) {
    return { type: 'null' };
  }
  if (Array.isArray(value)) {
    return { type: 'array', ctor: 'Array' };
  }
  if (typeof Map !== 'undefined' && value instanceof Map) {
    return { type: 'map', ctor: 'Map' };
  }
  if (typeof Set !== 'undefined' && value instanceof Set) {
    return { type: 'set', ctor: 'Set' };
  }
  if (value instanceof Date) {
    return { type: 'date', ctor: 'Date' };
  }
  if (value instanceof Error) {
    return {
      type: 'error',
      ctor: typeof value.name === 'string' && value.name.trim() ? value.name : 'Error',
    };
  }
  const valueType = typeof value;
  if (valueType !== 'object') {
    return { type: valueType };
  }
  const ctor =
    value && typeof value === 'object' && 'constructor' in value && value.constructor &&
    typeof value.constructor.name === 'string'
      ? value.constructor.name
      : undefined;
  return { type: 'object', ctor };
};
const describeInspectSize = (value, type) => {
  if (type === 'string') {
    return value.length + ' chars';
  }
  if (type === 'array') {
    return value.length + ' items';
  }
  if (type === 'map' || type === 'set') {
    return value.size + ' items';
  }
  if (type === 'object' && value && typeof value === 'object') {
    return Object.keys(value).length + ' keys';
  }
  return undefined;
};
const previewInspectValue = (value, type, ctor) => {
  if (type === 'array') {
    const items = value.slice(0, 3).map((item) => previewInspectAtom(item));
    return '[' + items.join(', ') + (value.length > 3 ? ', ...' : '') + ']';
  }
  if (type === 'map') {
    const items = Array.from(value.entries())
      .slice(0, 3)
      .map((pair) => previewInspectAtom(pair[0]) + ' => ' + previewInspectAtom(pair[1]));
    return 'Map(' + value.size + ') {' + items.join(', ') + (value.size > 3 ? ', ...' : '') + '}';
  }
  if (type === 'set') {
    const items = Array.from(value.values())
      .slice(0, 5)
      .map((item) => previewInspectAtom(item));
    return 'Set(' + value.size + ') {' + items.join(', ') + (value.size > 5 ? ', ...' : '') + '}';
  }
  if (type === 'date' || type === 'error' || type === 'function') {
    return previewInspectAtom(value);
  }
  if (type === 'object' && value && typeof value === 'object') {
    const keys = Object.keys(value);
    const shown = keys.slice(0, 4);
    const prefix = ctor && ctor !== 'Object' ? ctor + ' ' : '';
    return prefix + '{' + shown.join(', ') + (keys.length > shown.length ? ', ...' : '') + '}';
  }
  return previewInspectAtom(value);
};
const canCloneValue = (value, seen) => {
  const valueType = typeof value;
  if (valueType === 'function' || valueType === 'symbol') {
    return false;
  }
  if (value === null || valueType !== 'object') {
    return true;
  }
  if (seen.indexOf(value) >= 0) {
    return true;
  }
  seen.push(value);
  if (value instanceof Date || value instanceof RegExp || value instanceof Error) {
    return true;
  }
  if (typeof Map !== 'undefined' && value instanceof Map) {
    for (const pair of value.entries()) {
      if (!canCloneValue(pair[0], seen) || !canCloneValue(pair[1], seen)) return false;
    }
    return true;
  }
  if (typeof Set !== 'undefined' && value instanceof Set) {
    for (const item of value.values()) {
      if (!canCloneValue(item, seen)) return false;
    }
    return true;
  }
  for (const key of Object.keys(value)) {
    if (!canCloneValue(value[key], seen)) return false;
  }
  return true;
};
`;

function buildSupport() {
  const source = readFileSync(
    path.join(repoRoot, 'src/ax/util/jsAnalysis.ts'),
    'utf8'
  );
  const { code } = transformSync(source, {
    loader: 'ts',
    format: 'esm',
    target: 'es2015',
  });
  const analysis = code.replace(/\nexport \{[\s\S]*?\};\s*$/, '\n').trimEnd();
  if (analysis.includes('export ')) {
    throw new Error('jsAnalysis.ts transpiled with an unexpected export form');
  }
  const body = [
    '// Generated by scripts/axir-runtime-support.mjs from',
    '// src/ax/util/jsAnalysis.ts, src/ax/agent/contextManager.ts and',
    '// src/ax/funcs/worker.runtime.ts. Do not edit by hand.',
    '(function () {',
    analysis,
    CONTEXT_MANAGER_HELPERS.trim(),
    INSPECT_HELPERS.trim(),
    `globalThis.__ax_analyze_code = function (code) {
  const text = typeof code === 'string' ? code : '';
  return JSON.stringify({
    producedVars: extractTopLevelDurableWriteTargets(text),
    readVars: [...extractReadIdentifiers(text)],
    callables: extractDirectQualifiedCallableUsages(text),
  });
};
// src/ax/agent/agentInternal/sharedSession.ts buildDistillerFinalWrapperCode:
// in the distiller phase, final(task, evidence) with an evidence object
// keeps it as the distilledContext global, which the executor inherits with
// the session. The runtime calls this after installing its final primitive;
// a merge patch (the executor phase) sets __ax_phase to 'executor'.
globalThis.__ax_install_final_evidence = function () {
  const hostFinal = globalThis.final;
  if (typeof hostFinal !== 'function' || hostFinal.__ax_final_evidence === true) {
    return;
  }
  const wrapped = function () {
    const context = arguments[1];
    if (
      globalThis.__ax_phase !== 'executor' &&
      arguments.length === 2 &&
      context !== null &&
      typeof context === 'object' &&
      !Array.isArray(context)
    ) {
      globalThis.distilledContext = context;
    }
    return hostFinal.apply(this, arguments);
  };
  wrapped.__ax_final_evidence = true;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'final') || {};
  try {
    if (descriptor.configurable === false) {
      globalThis.final = wrapped;
    } else {
      Object.defineProperty(globalThis, 'final', {
        value: wrapped,
        writable: descriptor.writable !== false,
        enumerable: descriptor.enumerable === true,
        configurable: true,
      });
    }
  } catch (_error) {
    // A final the runtime cannot replace keeps its behavior.
  }
};
globalThis.__ax_inspect_entries = function (skipNames) {
  const skip = new Set(Array.isArray(skipNames) ? skipNames : []);
  const scope = globalThis;
  const entries = Object.getOwnPropertyNames(scope)
    .filter((name) => !skip.has(name) && !name.startsWith('_'))
    .sort()
    .map((name) => {
      try {
        const descriptor = Object.getOwnPropertyDescriptor(scope, name);
        if (!descriptor) {
          return undefined;
        }
        if ('get' in descriptor && typeof descriptor.get === 'function' && !('value' in descriptor)) {
          return { name, type: 'accessor', preview: '[getter omitted]', restorable: false };
        }
        const value = 'value' in descriptor ? descriptor.value : scope[name];
        const meta = describeInspectType(value);
        const size = describeInspectSize(value, meta.type);
        const preview = previewInspectValue(value, meta.type, meta.ctor);
        const entry = { name, type: meta.type };
        if (meta.ctor) entry.ctor = meta.ctor;
        if (size) entry.size = size;
        if (preview) entry.preview = truncateInspectText(preview, 96);
        entry.restorable = canCloneValue(value, []);
        return entry;
      } catch (_error) {
        return { name, type: 'unknown', preview: '[unavailable]', restorable: false };
      }
    })
    .filter((entry) => entry !== undefined);
  return JSON.stringify(entries);
};`,
    '})();',
    '',
  ].join('\n');
  // Every port embeds this in a raw or quoted string: keep it ASCII, with no
  // sequence that ends a Rust raw string or a C++ raw string.
  if (/[^\t\n\r -~]/.test(body)) {
    throw new Error('runtime support JavaScript must be ASCII');
  }
  if (body.includes('"#') || body.includes(')JS"')) {
    throw new Error('runtime support JavaScript ends a raw string');
  }
  return body;
}

const mode = process.argv[2] ?? 'check';
const next = buildSupport();
if (mode === 'write') {
  writeFileSync(outPath, next);
  console.log(`wrote ${path.relative(repoRoot, outPath)}`);
} else {
  const current = readFileSync(outPath, 'utf8');
  if (current !== next) {
    console.error(
      `${path.relative(repoRoot, outPath)} is stale; run node scripts/axir-runtime-support.mjs write`
    );
    process.exit(1);
  }
  console.log('runtime support JavaScript is up to date');
}
