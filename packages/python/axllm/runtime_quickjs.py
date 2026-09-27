"""Optional in-process QuickJS runtime profile for AxAgent.

Requires the ``quickjs`` wheel (``pip install axllm[runtime-quickjs]``). This gives the
agent a real JavaScript engine in-process: the executor stage writes JS, this engine runs
it, and ``final(...)`` / ``askClarification(...)`` produce the completion the agent loop
consumes -- the same contract the Go (goja) and other quickjs profiles satisfy.

    from axllm import agent
    from axllm.runtime_quickjs import AxQuickJsCodeRuntime

    runtime = AxQuickJsCodeRuntime().register_callable("search", lambda p: {"hits": []})
    qa = agent("question:string -> answer:string", {"runtime": {"language": "JavaScript"}})
    out = qa.forward(client, {"question": "..."}, {"runtime": runtime})
"""

from __future__ import annotations

import json
from typing import Any

from .agent import AxCodeRuntime, AxCodeSession

# JS prelude: defines the runtime primitives (final/askClarification/discover/recall/used/
# report*/guideAgent) which write a completion cell, plus the host-callable bridge. Helper
# names avoid a leading underscore so they read as JS, not python helpers.
_PRELUDE = (
    "function axComplete(v){globalThis.__ax_completion=v;return v;}"
    "function final(){return axComplete({type:'final',args:Array.from(arguments)});}"
    "function respond(){return axComplete({type:'respond',args:Array.from(arguments)});}"
    "function askClarification(){return axComplete({type:'askClarification',args:Array.from(arguments)});}"
    "function discover(r){return axComplete({kind:'discover',discover:r});}"
    "function recall(r){return axComplete({kind:'recall',recall:r});}"
    "function used(i,reason){var p=(i&&typeof i==='object')?i:{id:i};if(reason!==undefined&&reason!==null)p.reason=String(reason);return axComplete({kind:'used',used:p});}"
    "function reportSuccess(m){return axComplete({kind:'status',status:{type:'success',message:String(m||'')}});}"
    "function reportFailure(m){return axComplete({kind:'status',status:{type:'failed',message:String(m||'')}});}"
    "function guideAgent(g){return axComplete({type:'guide_agent',guidance:String(g||'')});}"
    "function axHe(m,c){var e=new Error(String(m||'host callable failed'));e.error_category=String(c||'runtime');return e;}"
    "function axHc(name){return function(params){var r=JSON.parse(globalThis.__ax_host_call(name,JSON.stringify(params===undefined?null:params)));if(r.ok)return r.result;throw axHe(r.error||('host callable failed: '+name),r.category);};}"
    "function axSnap(){var R=globalThis.__ax_reserved||{};var o={};for(var k of Object.getOwnPropertyNames(globalThis)){if(k.indexOf('__ax_')===0)continue;if(R[k])continue;var v=globalThis[k];if(typeof v==='function'||typeof v==='undefined')continue;try{JSON.stringify(v);o[k]=v;}catch(e){}}return JSON.stringify(o);}"
    # console: the executor inspects intermediate values with console.log; capture each
    # turn's output into __ax_logs so the host can surface it back into the action log.
    "function axLog(){var a=Array.prototype.slice.call(arguments);globalThis.__ax_logs.push(a.map(function(x){return (typeof x==='string')?x:(function(){try{return JSON.stringify(x);}catch(e){return String(x);}})();}).join(' '));}"
    "globalThis.console={log:axLog,error:axLog,warn:axLog,info:axLog,debug:axLog};"
    # Persistence suffix: the RLM prompt promises a long-running REPL where state
    # persists across turns, but each turn runs in a fresh async wrapper so top-level
    # const/let/var would vanish. Mirror the TS runtime: extract top-level declared
    # names and assign them onto globalThis (the one scope that persists) after the
    # turn's code. Fail-open (per-assignment try/catch) so nested/undeclared names are
    # harmlessly skipped. See src/ax/funcs/worker.runtime.ts.
    "function axPersistSuffix(src){try{var n=[],s={},re=/(?:^|[\\n;{}])\\s*(?:export\\s+)?(?:async\\s+)?(?:function|class|const|let|var)\\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,m;while((m=re.exec(src))){if(!s[m[1]]){s[m[1]]=1;n.push(m[1]);}}return n.map(function(x){return 'try{globalThis['+JSON.stringify(x)+']='+x+';}catch(__e){}';}).join('');}catch(__e){return '';}}"
)


_HOST_NAMESPACES = "var __ax_host_namespaces = Object.create(null);\nfunction __ax_bind_host_namespaces() {\n  const roots = [];\n  for (const name of Object.getOwnPropertyNames(globalThis)) {\n    if (name.indexOf('.') < 0) continue;\n    const callable = Object.getOwnPropertyDescriptor(globalThis, name);\n    if (!callable || typeof callable.value !== 'function') continue;\n    const parts = name.split('.');\n    if (parts.some(part => !part)) {\n      throw new Error('Invalid host callable namespace: ' + name);\n    }\n    let target = globalThis;\n    let path = '';\n    for (let index = 0; index < parts.length - 1; index++) {\n      const part = parts[index];\n      path += (index ? '.' : '') + part;\n      let entry = Object.getOwnPropertyDescriptor(target, part);\n      if (!entry) {\n        const value = Object.create(null);\n        Object.defineProperty(target, part, {value, enumerable: true});\n        __ax_host_namespaces[path] = value;\n        entry = {value};\n      }\n      if (entry.value !== __ax_host_namespaces[path]) {\n        throw new Error('Host callable namespace conflicts with a global: ' + path);\n      }\n      target = entry.value;\n    }\n    const leaf = parts[parts.length - 1];\n    const existing = Object.getOwnPropertyDescriptor(target, leaf);\n    if (existing && existing.value !== callable.value) {\n      throw new Error('Host callable name conflicts with a namespace: ' + name);\n    }\n    if (!existing) Object.defineProperty(target, leaf, {value: callable.value, enumerable: true});\n    if (roots.indexOf(parts[0]) < 0) roots.push(parts[0]);\n  }\n  if (Array.isArray(globalThis.__ax_session_reserved)) {\n    for (const root of roots) {\n      if (globalThis.__ax_session_reserved.indexOf(root) < 0) globalThis.__ax_session_reserved.push(root);\n    }\n  }\n  return roots;\n}\n"

# TypeScript's action-log code analysis and AxJSRuntime snapshot entries,
# shared by the ports' JavaScript runtimes (scripts/axir-runtime-support.mjs).
_RUNTIME_SUPPORT = "// Generated by scripts/axir-runtime-support.mjs from\n// src/ax/util/jsAnalysis.ts, src/ax/agent/contextManager.ts and\n// src/ax/funcs/worker.runtime.ts. Do not edit by hand.\n(function () {\nfunction isIdentifierChar(ch) {\n  return !!ch && /[A-Za-z0-9_$]/.test(ch);\n}\nfunction isIdentifierStart(ch) {\n  return !!ch && /[A-Za-z_$]/.test(ch);\n}\nfunction stripJsStringsAndComments(code) {\n  var _a, _b;\n  let out = \"\";\n  let i = 0;\n  let state = \"normal\";\n  let escaped = false;\n  while (i < code.length) {\n    const ch = (_a = code[i]) != null ? _a : \"\";\n    const next = (_b = code[i + 1]) != null ? _b : \"\";\n    if (state === \"lineComment\") {\n      if (ch === \"\\n\") {\n        out += \"\\n\";\n        state = \"normal\";\n      } else {\n        out += \" \";\n      }\n      i++;\n      continue;\n    }\n    if (state === \"blockComment\") {\n      if (ch === \"*\" && next === \"/\") {\n        out += \"  \";\n        i += 2;\n        state = \"normal\";\n      } else {\n        out += ch === \"\\n\" ? \"\\n\" : \" \";\n        i++;\n      }\n      continue;\n    }\n    if (state === \"single\" || state === \"double\" || state === \"template\") {\n      const quote = state === \"single\" ? \"'\" : state === \"double\" ? '\"' : \"`\";\n      if (escaped) {\n        out += ch === \"\\n\" ? \"\\n\" : \" \";\n        escaped = false;\n        i++;\n        continue;\n      }\n      if (ch === \"\\\\\") {\n        out += \" \";\n        escaped = true;\n        i++;\n        continue;\n      }\n      if (ch === quote) {\n        out += \" \";\n        state = \"normal\";\n        i++;\n        continue;\n      }\n      out += ch === \"\\n\" ? \"\\n\" : \" \";\n      i++;\n      continue;\n    }\n    if (ch === \"/\" && next === \"/\") {\n      out += \"  \";\n      i += 2;\n      state = \"lineComment\";\n      continue;\n    }\n    if (ch === \"/\" && next === \"*\") {\n      out += \"  \";\n      i += 2;\n      state = \"blockComment\";\n      continue;\n    }\n    if (ch === \"'\") {\n      out += \" \";\n      i++;\n      state = \"single\";\n      continue;\n    }\n    if (ch === '\"') {\n      out += \" \";\n      i++;\n      state = \"double\";\n      continue;\n    }\n    if (ch === \"`\") {\n      out += \" \";\n      i++;\n      state = \"template\";\n      continue;\n    }\n    out += ch;\n    i++;\n  }\n  return out;\n}\nfunction extractTopLevelDeclaredNames(code) {\n  const names = [];\n  const len = code.length;\n  let i = 0;\n  let braceDepth = 0;\n  let parenDepth = 0;\n  const skipString = (quote) => {\n    i++;\n    if (quote === \"`\") {\n      let templateDepth = 0;\n      while (i < len) {\n        const ch = code[i];\n        if (ch === \"\\\\\") {\n          i += 2;\n          continue;\n        }\n        if (templateDepth > 0) {\n          if (ch === \"{\") {\n            templateDepth++;\n          } else if (ch === \"}\") {\n            templateDepth--;\n          }\n          i++;\n          continue;\n        }\n        if (ch === \"$\" && i + 1 < len && code[i + 1] === \"{\") {\n          templateDepth++;\n          i += 2;\n          continue;\n        }\n        if (ch === \"`\") {\n          i++;\n          return;\n        }\n        i++;\n      }\n      return;\n    }\n    while (i < len) {\n      const ch = code[i];\n      if (ch === \"\\\\\") {\n        i += 2;\n        continue;\n      }\n      if (ch === quote) {\n        i++;\n        return;\n      }\n      i++;\n    }\n  };\n  const skipLineComment = () => {\n    i += 2;\n    while (i < len && code[i] !== \"\\n\") {\n      i++;\n    }\n  };\n  const skipBlockComment = () => {\n    i += 2;\n    while (i < len) {\n      if (code[i] === \"*\" && i + 1 < len && code[i + 1] === \"/\") {\n        i += 2;\n        return;\n      }\n      i++;\n    }\n  };\n  const readWord = () => {\n    const start = i;\n    while (i < len && isIdentifierChar(code[i])) {\n      i++;\n    }\n    return code.slice(start, i);\n  };\n  const skipWhitespace = () => {\n    const start = i;\n    while (i < len) {\n      const ch = code[i];\n      if (ch === \" \" || ch === \"\t\" || ch === \"\\n\" || ch === \"\\r\") {\n        i++;\n        continue;\n      }\n      if (ch === \"/\" && i + 1 < len) {\n        if (code[i + 1] === \"/\") {\n          skipLineComment();\n          continue;\n        }\n        if (code[i + 1] === \"*\") {\n          skipBlockComment();\n          continue;\n        }\n      }\n      break;\n    }\n    return i > start;\n  };\n  const extractDestructuredNames = (close) => {\n    let depth = 1;\n    while (i < len && depth > 0) {\n      skipWhitespace();\n      if (i >= len) return;\n      const ch = code[i];\n      if (ch === close) {\n        depth--;\n        i++;\n        continue;\n      }\n      if (ch === \"{\" || ch === \"[\") {\n        const nestedClose = ch === \"{\" ? \"}\" : \"]\";\n        i++;\n        extractDestructuredNames(nestedClose);\n        continue;\n      }\n      if (ch === \".\" && i + 2 < len && code[i + 1] === \".\" && code[i + 2] === \".\") {\n        i += 3;\n        skipWhitespace();\n        if (i < len && isIdentifierChar(code[i])) {\n          const name = readWord();\n          if (name) names.push(name);\n        }\n        continue;\n      }\n      if (ch === \",\") {\n        i++;\n        continue;\n      }\n      if (ch === \"=\") {\n        i++;\n        let eqDepth = 0;\n        while (i < len) {\n          const current = code[i];\n          if (current === \"'\" || current === '\"' || current === \"`\") {\n            skipString(current);\n            continue;\n          }\n          if (current === \"(\" || current === \"[\" || current === \"{\") {\n            eqDepth++;\n            i++;\n            continue;\n          }\n          if (current === \")\" || current === \"]\" || current === \"}\") {\n            if (eqDepth > 0) {\n              eqDepth--;\n              i++;\n              continue;\n            }\n            break;\n          }\n          if (current === \",\" && eqDepth === 0) {\n            break;\n          }\n          i++;\n        }\n        continue;\n      }\n      if (isIdentifierChar(ch)) {\n        const word = readWord();\n        skipWhitespace();\n        if (i < len && code[i] === \":\") {\n          i++;\n          skipWhitespace();\n          if (i < len) {\n            const current = code[i];\n            if (current === \"{\" || current === \"[\") {\n              const nestedClose = current === \"{\" ? \"}\" : \"]\";\n              i++;\n              extractDestructuredNames(nestedClose);\n            } else if (isIdentifierChar(current)) {\n              const renamed = readWord();\n              if (renamed) names.push(renamed);\n            }\n          }\n        } else if (word) {\n          names.push(word);\n        }\n        continue;\n      }\n      i++;\n    }\n  };\n  const skipToCommaOrEnd = () => {\n    let depth = 0;\n    while (i < len) {\n      const ch = code[i];\n      if (ch === \"'\" || ch === '\"' || ch === \"`\") {\n        skipString(ch);\n        continue;\n      }\n      if (ch === \"/\" && i + 1 < len) {\n        if (code[i + 1] === \"/\") {\n          skipLineComment();\n          continue;\n        }\n        if (code[i + 1] === \"*\") {\n          skipBlockComment();\n          continue;\n        }\n      }\n      if (ch === \"(\" || ch === \"[\" || ch === \"{\") {\n        depth++;\n        i++;\n        continue;\n      }\n      if (ch === \")\" || ch === \"]\" || ch === \"}\") {\n        if (depth > 0) {\n          depth--;\n          i++;\n          continue;\n        }\n        return false;\n      }\n      if (ch === \",\" && depth === 0) {\n        i++;\n        return true;\n      }\n      if (ch === \";\" && depth === 0) {\n        i++;\n        return false;\n      }\n      if (ch === \"\\n\" && depth === 0) {\n        const savedIndex = i;\n        i++;\n        skipWhitespace();\n        if (i < len && code[i] === \",\") {\n          i++;\n          return true;\n        }\n        i = savedIndex;\n        return false;\n      }\n      i++;\n    }\n    return false;\n  };\n  const extractBindings = () => {\n    while (i < len) {\n      skipWhitespace();\n      if (i >= len) return;\n      const ch = code[i];\n      if (ch === \"{\") {\n        i++;\n        extractDestructuredNames(\"}\");\n        if (!skipToCommaOrEnd()) return;\n        continue;\n      }\n      if (ch === \"[\") {\n        i++;\n        extractDestructuredNames(\"]\");\n        if (!skipToCommaOrEnd()) return;\n        continue;\n      }\n      if (isIdentifierChar(ch)) {\n        const name = readWord();\n        if (name) names.push(name);\n        if (!skipToCommaOrEnd()) return;\n        continue;\n      }\n      return;\n    }\n  };\n  const isStatementBoundary = (pos) => {\n    if (pos === 0) return true;\n    let j = pos - 1;\n    while (j >= 0) {\n      const ch = code[j];\n      if (ch === \" \" || ch === \"\t\" || ch === \"\\r\") {\n        j--;\n        continue;\n      }\n      return ch === \"\\n\" || ch === \";\" || ch === \"{\" || ch === \"}\";\n    }\n    return true;\n  };\n  while (i < len) {\n    const ch = code[i];\n    if (ch === \"'\" || ch === '\"' || ch === \"`\") {\n      skipString(ch);\n      continue;\n    }\n    if (ch === \"/\" && i + 1 < len) {\n      if (code[i + 1] === \"/\") {\n        skipLineComment();\n        continue;\n      }\n      if (code[i + 1] === \"*\") {\n        skipBlockComment();\n        continue;\n      }\n    }\n    if (ch === \"{\") {\n      braceDepth++;\n      i++;\n      continue;\n    }\n    if (ch === \"}\") {\n      braceDepth--;\n      i++;\n      continue;\n    }\n    if (ch === \"(\") {\n      parenDepth++;\n      i++;\n      continue;\n    }\n    if (ch === \")\") {\n      parenDepth--;\n      i++;\n      continue;\n    }\n    if (braceDepth === 0 && parenDepth === 0 && isIdentifierChar(ch)) {\n      const wordStart = i;\n      const word = readWord();\n      if ((word === \"var\" || word === \"let\" || word === \"const\") && i < len && (code[i] === \" \" || code[i] === \"\t\" || code[i] === \"\\n\") && isStatementBoundary(wordStart)) {\n        extractBindings();\n      }\n      continue;\n    }\n    i++;\n  }\n  const seen = /* @__PURE__ */ new Set();\n  const unique = [];\n  for (const name of names) {\n    if (!seen.has(name)) {\n      seen.add(name);\n      unique.push(name);\n    }\n  }\n  return unique;\n}\nfunction extractTopLevelDurableWriteTargets(code) {\n  const names = new Set(extractTopLevelDeclaredNames(code));\n  const sanitized = stripJsStringsAndComments(code);\n  const len = sanitized.length;\n  let i = 0;\n  let braceDepth = 0;\n  let parenDepth = 0;\n  const skipWhitespace = (index) => {\n    var _a;\n    let current = index;\n    while (current < len && /\\s/.test((_a = sanitized[current]) != null ? _a : \"\")) {\n      current++;\n    }\n    return current;\n  };\n  const previousNonWhitespaceIndex = (index) => {\n    var _a;\n    let current = index;\n    while (current >= 0 && /\\s/.test((_a = sanitized[current]) != null ? _a : \"\")) {\n      current--;\n    }\n    return current;\n  };\n  const isAssignmentOperatorAt = (index) => {\n    const threeChars = sanitized.slice(index, index + 3);\n    const twoChars = sanitized.slice(index, index + 2);\n    if (threeChars === \"===\" || twoChars === \"==\" || twoChars === \"=>\") {\n      return false;\n    }\n    return sanitized[index] === \"=\" || [\n      \"+=\",\n      \"-=\",\n      \"*=\",\n      \"/=\",\n      \"%=\",\n      \"&=\",\n      \"|=\",\n      \"^=\",\n      \"&&=\",\n      \"||=\",\n      \"??=\",\n      \"**=\",\n      \"<<=\",\n      \">>=\",\n      \">>>=\"\n    ].some((op) => sanitized.startsWith(op, index));\n  };\n  const readWord = (start) => {\n    let nextIndex = start;\n    while (nextIndex < len && isIdentifierChar(sanitized[nextIndex])) {\n      nextIndex++;\n    }\n    return { word: sanitized.slice(start, nextIndex), nextIndex };\n  };\n  const addIfBareAssignment = (word, start, end) => {\n    const prevIndex = previousNonWhitespaceIndex(start - 1);\n    const prev = prevIndex >= 0 ? sanitized[prevIndex] : void 0;\n    const nextIndex = skipWhitespace(end);\n    const isMemberAccess = prev === \".\" || prev === \"?\";\n    if (isMemberAccess) {\n      return;\n    }\n    const hasPrefixUpdate = sanitized.slice(Math.max(0, start - 2), start) === \"++\" || sanitized.slice(Math.max(0, start - 2), start) === \"--\";\n    const hasSuffixUpdate = sanitized.startsWith(\"++\", nextIndex) || sanitized.startsWith(\"--\", nextIndex);\n    if (hasPrefixUpdate || hasSuffixUpdate || isAssignmentOperatorAt(nextIndex)) {\n      names.add(word);\n    }\n  };\n  const addIfGlobalAssignment = (start, end) => {\n    const dotIndex = skipWhitespace(end);\n    if (sanitized[dotIndex] !== \".\") {\n      return;\n    }\n    const nameStart = skipWhitespace(dotIndex + 1);\n    if (!isIdentifierStart(sanitized[nameStart])) {\n      return;\n    }\n    const { word: propertyName, nextIndex } = readWord(nameStart);\n    const operatorIndex = skipWhitespace(nextIndex);\n    const hasPrefixUpdate = sanitized.slice(Math.max(0, start - 2), start) === \"++\" || sanitized.slice(Math.max(0, start - 2), start) === \"--\";\n    const hasSuffixUpdate = sanitized.startsWith(\"++\", operatorIndex) || sanitized.startsWith(\"--\", operatorIndex);\n    if (propertyName && (hasPrefixUpdate || hasSuffixUpdate || isAssignmentOperatorAt(operatorIndex))) {\n      names.add(propertyName);\n    }\n  };\n  while (i < len) {\n    const ch = sanitized[i];\n    if (ch === \"{\") {\n      braceDepth++;\n      i++;\n      continue;\n    }\n    if (ch === \"}\") {\n      braceDepth--;\n      i++;\n      continue;\n    }\n    if (ch === \"(\") {\n      parenDepth++;\n      i++;\n      continue;\n    }\n    if (ch === \")\") {\n      parenDepth--;\n      i++;\n      continue;\n    }\n    if (braceDepth === 0 && parenDepth === 0 && isIdentifierStart(ch)) {\n      const start = i;\n      const { word, nextIndex } = readWord(i);\n      i = nextIndex;\n      if (!word) {\n        continue;\n      }\n      if (word === \"globalThis\") {\n        addIfGlobalAssignment(start, nextIndex);\n        continue;\n      }\n      addIfBareAssignment(word, start, nextIndex);\n      continue;\n    }\n    i++;\n  }\n  return [...names];\n}\nconst JS_KEYWORDS = new Set([\n  'var', 'let', 'const', 'function', 'return', 'if', 'else', 'for', 'while',\n  'do', 'switch', 'case', 'break', 'continue', 'try', 'catch', 'finally',\n  'throw', 'new', 'delete', 'typeof', 'void', 'in', 'of', 'instanceof',\n  'this', 'class', 'extends', 'super', 'import', 'export', 'default', 'from',\n  'as', 'async', 'await', 'yield', 'true', 'false', 'null', 'undefined',\n  'console', 'log'\n]);\nfunction extractReferencedIdentifiers(code) {\n  const sanitized = stripJsStringsAndComments(code);\n  const identRegex = /\\b([a-zA-Z_$][a-zA-Z0-9_$]*)\\b/g;\n  const ids = new Set();\n  let match = identRegex.exec(sanitized);\n  while (match !== null) {\n    if (match[1] && !JS_KEYWORDS.has(match[1])) {\n      ids.add(match[1]);\n    }\n    match = identRegex.exec(sanitized);\n  }\n  return ids;\n}\nfunction extractReadIdentifiers(code) {\n  const reads = extractReferencedIdentifiers(code);\n  for (const declared of extractTopLevelDeclaredNames(code)) {\n    reads.delete(declared);\n  }\n  return reads;\n}\nfunction extractDirectQualifiedCallableUsages(code) {\n  const sanitized = stripJsStringsAndComments(code);\n  const usages = new Set();\n  const callPattern = /\\b([a-zA-Z_$][a-zA-Z0-9_$]*)\\.([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*\\(/g;\n  let match = callPattern.exec(sanitized);\n  while (match) {\n    const namespace = match[1];\n    const name = match[2];\n    if (namespace && name) {\n      usages.add(namespace + '.' + name);\n    }\n    match = callPattern.exec(sanitized);\n  }\n  return [...usages];\n}\nconst truncateInspectText = (text, maxChars) =>\n  text.length <= maxChars ? text : text.slice(0, maxChars - 3) + '...';\nconst previewInspectAtom = (value) => {\n  if (value === null) {\n    return 'null';\n  }\n  if (value === undefined) {\n    return 'undefined';\n  }\n  const valueType = typeof value;\n  if (typeof value === 'string') {\n    return JSON.stringify(truncateInspectText(value, 40));\n  }\n  if (valueType === 'number' || valueType === 'boolean' || valueType === 'bigint') {\n    return String(value);\n  }\n  if (valueType === 'symbol') {\n    return String(value);\n  }\n  if (valueType === 'function') {\n    const fnName = value.name && typeof value.name === 'string' ? value.name : '';\n    return '[function ' + (fnName || 'anonymous') + ']';\n  }\n  if (Array.isArray(value)) {\n    return '[array(' + value.length + ')]';\n  }\n  if (value instanceof Date) {\n    return Number.isFinite(value.getTime()) ? value.toISOString() : String(value);\n  }\n  if (value instanceof Error) {\n    return (value.name || 'Error') + ': ' + (value.message || '');\n  }\n  if (typeof Map !== 'undefined' && value instanceof Map) {\n    return '[map(' + value.size + ')]';\n  }\n  if (typeof Set !== 'undefined' && value instanceof Set) {\n    return '[set(' + value.size + ')]';\n  }\n  const ctorName =\n    value && typeof value === 'object' && 'constructor' in value && value.constructor &&\n    typeof value.constructor.name === 'string'\n      ? value.constructor.name\n      : '';\n  return ctorName && ctorName !== 'Object' ? '[' + ctorName + ']' : '[object]';\n};\nconst describeInspectType = (value) => {\n  if (value === null) {\n    return { type: 'null' };\n  }\n  if (Array.isArray(value)) {\n    return { type: 'array', ctor: 'Array' };\n  }\n  if (typeof Map !== 'undefined' && value instanceof Map) {\n    return { type: 'map', ctor: 'Map' };\n  }\n  if (typeof Set !== 'undefined' && value instanceof Set) {\n    return { type: 'set', ctor: 'Set' };\n  }\n  if (value instanceof Date) {\n    return { type: 'date', ctor: 'Date' };\n  }\n  if (value instanceof Error) {\n    return {\n      type: 'error',\n      ctor: typeof value.name === 'string' && value.name.trim() ? value.name : 'Error',\n    };\n  }\n  const valueType = typeof value;\n  if (valueType !== 'object') {\n    return { type: valueType };\n  }\n  const ctor =\n    value && typeof value === 'object' && 'constructor' in value && value.constructor &&\n    typeof value.constructor.name === 'string'\n      ? value.constructor.name\n      : undefined;\n  return { type: 'object', ctor };\n};\nconst describeInspectSize = (value, type) => {\n  if (type === 'string') {\n    return value.length + ' chars';\n  }\n  if (type === 'array') {\n    return value.length + ' items';\n  }\n  if (type === 'map' || type === 'set') {\n    return value.size + ' items';\n  }\n  if (type === 'object' && value && typeof value === 'object') {\n    return Object.keys(value).length + ' keys';\n  }\n  return undefined;\n};\nconst previewInspectValue = (value, type, ctor) => {\n  if (type === 'array') {\n    const items = value.slice(0, 3).map((item) => previewInspectAtom(item));\n    return '[' + items.join(', ') + (value.length > 3 ? ', ...' : '') + ']';\n  }\n  if (type === 'map') {\n    const items = Array.from(value.entries())\n      .slice(0, 3)\n      .map((pair) => previewInspectAtom(pair[0]) + ' => ' + previewInspectAtom(pair[1]));\n    return 'Map(' + value.size + ') {' + items.join(', ') + (value.size > 3 ? ', ...' : '') + '}';\n  }\n  if (type === 'set') {\n    const items = Array.from(value.values())\n      .slice(0, 5)\n      .map((item) => previewInspectAtom(item));\n    return 'Set(' + value.size + ') {' + items.join(', ') + (value.size > 5 ? ', ...' : '') + '}';\n  }\n  if (type === 'date' || type === 'error' || type === 'function') {\n    return previewInspectAtom(value);\n  }\n  if (type === 'object' && value && typeof value === 'object') {\n    const keys = Object.keys(value);\n    const shown = keys.slice(0, 4);\n    const prefix = ctor && ctor !== 'Object' ? ctor + ' ' : '';\n    return prefix + '{' + shown.join(', ') + (keys.length > shown.length ? ', ...' : '') + '}';\n  }\n  return previewInspectAtom(value);\n};\nconst canCloneValue = (value, seen) => {\n  const valueType = typeof value;\n  if (valueType === 'function' || valueType === 'symbol') {\n    return false;\n  }\n  if (value === null || valueType !== 'object') {\n    return true;\n  }\n  if (seen.indexOf(value) >= 0) {\n    return true;\n  }\n  seen.push(value);\n  if (value instanceof Date || value instanceof RegExp || value instanceof Error) {\n    return true;\n  }\n  if (typeof Map !== 'undefined' && value instanceof Map) {\n    for (const pair of value.entries()) {\n      if (!canCloneValue(pair[0], seen) || !canCloneValue(pair[1], seen)) return false;\n    }\n    return true;\n  }\n  if (typeof Set !== 'undefined' && value instanceof Set) {\n    for (const item of value.values()) {\n      if (!canCloneValue(item, seen)) return false;\n    }\n    return true;\n  }\n  for (const key of Object.keys(value)) {\n    if (!canCloneValue(value[key], seen)) return false;\n  }\n  return true;\n};\nglobalThis.__ax_analyze_code = function (code) {\n  const text = typeof code === 'string' ? code : '';\n  return JSON.stringify({\n    producedVars: extractTopLevelDurableWriteTargets(text),\n    readVars: [...extractReadIdentifiers(text)],\n    callables: extractDirectQualifiedCallableUsages(text),\n  });\n};\n// src/ax/agent/agentInternal/sharedSession.ts buildDistillerFinalWrapperCode:\n// in the distiller phase, final(task, evidence) with an evidence object\n// keeps it as the distilledContext global, which the executor inherits with\n// the session. The runtime calls this after installing its final primitive;\n// a merge patch (the executor phase) sets __ax_phase to 'executor'.\nglobalThis.__ax_install_final_evidence = function () {\n  const hostFinal = globalThis.final;\n  if (typeof hostFinal !== 'function' || hostFinal.__ax_final_evidence === true) {\n    return;\n  }\n  const wrapped = function () {\n    const context = arguments[1];\n    if (\n      globalThis.__ax_phase !== 'executor' &&\n      arguments.length === 2 &&\n      context !== null &&\n      typeof context === 'object' &&\n      !Array.isArray(context)\n    ) {\n      globalThis.distilledContext = context;\n    }\n    return hostFinal.apply(this, arguments);\n  };\n  wrapped.__ax_final_evidence = true;\n  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'final') || {};\n  try {\n    if (descriptor.configurable === false) {\n      globalThis.final = wrapped;\n    } else {\n      Object.defineProperty(globalThis, 'final', {\n        value: wrapped,\n        writable: descriptor.writable !== false,\n        enumerable: descriptor.enumerable === true,\n        configurable: true,\n      });\n    }\n  } catch (_error) {\n    // A final the runtime cannot replace keeps its behavior.\n  }\n};\nglobalThis.__ax_inspect_entries = function (skipNames) {\n  const skip = new Set(Array.isArray(skipNames) ? skipNames : []);\n  const scope = globalThis;\n  const entries = Object.getOwnPropertyNames(scope)\n    .filter((name) => !skip.has(name) && !name.startsWith('_'))\n    .sort()\n    .map((name) => {\n      try {\n        const descriptor = Object.getOwnPropertyDescriptor(scope, name);\n        if (!descriptor) {\n          return undefined;\n        }\n        if ('get' in descriptor && typeof descriptor.get === 'function' && !('value' in descriptor)) {\n          return { name, type: 'accessor', preview: '[getter omitted]', restorable: false };\n        }\n        const value = 'value' in descriptor ? descriptor.value : scope[name];\n        const meta = describeInspectType(value);\n        const size = describeInspectSize(value, meta.type);\n        const preview = previewInspectValue(value, meta.type, meta.ctor);\n        const entry = { name, type: meta.type };\n        if (meta.ctor) entry.ctor = meta.ctor;\n        if (size) entry.size = size;\n        if (preview) entry.preview = truncateInspectText(preview, 96);\n        entry.restorable = canCloneValue(value, []);\n        return entry;\n      } catch (_error) {\n        return { name, type: 'unknown', preview: '[unavailable]', restorable: false };\n      }\n    })\n    .filter((entry) => entry !== undefined);\n  return JSON.stringify(entries);\n};\n})();\n"

# TypeScript's AxJSRuntime.getUsageInstructions() in its default stdout mode.
_USAGE_INSTRUCTIONS = "\n".join(
    "- " + line
    for line in (
        "Don't wrap async code in (async()=>{ ... })() \u2014 the runtime automatically handles async execution.",
        "State is session-scoped: all top-level declarations (`var`, `let`, `const`) persist across calls.",
        "Bare assignment (e.g. `x = 1`) also persists via `globalThis`.",
        "Use `console.log(...)` output is captured as the execution result so use it to inspect intermediate values between steps instead of `return`.",
    )
)


class AxQuickJsCodeSession(AxCodeSession):
    def __init__(self, runtime, globals_, options=None):
        self.runtime = runtime
        self.host_callables = dict(runtime.host_callables)
        self.closed = False
        self.ctx = runtime._quickjs.Context()
        self.ctx.add_callable("__ax_host_call", self._host_call)
        self.ctx.eval(_PRELUDE)
        for name in self.host_callables:
            self.ctx.eval("globalThis[%s]=axHc(%s);" % (json.dumps(name), json.dumps(name)))
        for key, value in (globals_ or {}).items():
            self.ctx.eval("globalThis[%s]=JSON.parse(%s);" % (json.dumps(key), json.dumps(json.dumps(value))))
        self.ctx.eval(_HOST_NAMESPACES)
        self.ctx.eval("__ax_bind_host_namespaces()")
        self.ctx.eval(_RUNTIME_SUPPORT)
        # Baseline of reserved globals: every name present before the agent runs any
        # code (JS built-ins like Math/JSON/Reflect, the prelude helpers, host callables,
        # and injected inputs). axSnap excludes these so the runtime-state summary shows
        # only the model's own variables, not engine built-ins (which would otherwise
        # crowd out real variables under the maxEntries cap).
        self.ctx.eval("globalThis.__ax_reserved=Object.create(null);Object.getOwnPropertyNames(globalThis).forEach(function(k){globalThis.__ax_reserved[k]=1;});")

    def _host_call(self, name, params_json):
        handler = self.host_callables.get(name)
        if handler is None:
            return json.dumps({"ok": False, "category": "runtime", "error": "unknown host callable: " + name})
        try:
            return json.dumps({"ok": True, "result": handler(json.loads(params_json))})
        except Exception as exc:
            category = getattr(exc, "error_category", None) or getattr(exc, "category", None) or "runtime"
            return json.dumps({"ok": False, "category": str(category), "error": str(exc)})

    def execute(self, code: str, options: dict[str, Any] | None = None) -> Any:
        if self.closed:
            return {"is_error": True, "error_category": "session_closed", "error": "session closed"}
        # The RLM prompt has the model write `await final(...)` / `await llmQuery(...)`, so the
        # code uses top-level await — illegal in a plain script eval. Run it inside an async IIFE
        # (await becomes legal) and drain the job queue so awaited continuations and the
        # synchronous host primitives that set __ax_completion actually run before we read it.
        self.ctx.eval(
            "globalThis.__ax_completion=undefined;globalThis.__ax_result=undefined;"
            "globalThis.__ax_error=undefined;globalThis.__ax_error_category=undefined;globalThis.__ax_logs=[];"
        )
        try:
            persist_suffix = self.ctx.eval("axPersistSuffix(" + json.dumps(code) + ")") or ""
        except Exception:
            persist_suffix = ""
        # TS's analysis of the turn's code, for the variables' provenance.
        try:
            analysis = json.loads(self.ctx.eval("__ax_analyze_code(" + json.dumps(code) + ")"))
        except Exception:
            analysis = None
        # TS's distiller final: final(task, evidence) keeps the evidence as the
        # distilledContext global the executor inherits.
        self.ctx.eval("__ax_install_final_evidence()")
        wrapper = (
            "(async()=>{\n" + code + "\n" + persist_suffix + "\n})().then("
            "function(r){globalThis.__ax_result=r;},"
            "function(e){globalThis.__ax_error_category=String((e&&(e.error_category||e.category))||'runtime');globalThis.__ax_error=String((e&&e.message)?((e.name?e.name+': ':'')+e.message+(e.stack?(' '+e.stack):'')):((e&&e.stack)?e.stack:e));});"
        )
        try:
            self.ctx.eval(wrapper)
            for _ in range(1000000):
                if not self.ctx.execute_pending_job():
                    break
        except Exception as exc:
            return {"kind": "error", "is_error": True, "error_category": "runtime", "error": str(exc), "analysis": analysis}
        err = self.ctx.eval("globalThis.__ax_error===undefined?null:globalThis.__ax_error")
        if err is not None:
            category = self.ctx.eval("globalThis.__ax_error_category===undefined?'runtime':globalThis.__ax_error_category")
            return {"kind": "error", "is_error": True, "error_category": str(category or "runtime"), "error": str(err), "analysis": analysis}
        try:
            logs = json.loads(self.ctx.eval("JSON.stringify(globalThis.__ax_logs||[])"))
        except Exception:
            logs = []
        payload = json.loads(self.ctx.eval(
            "JSON.stringify(globalThis.__ax_completion!==undefined?globalThis.__ax_completion:"
            "{kind:'result',result:(globalThis.__ax_result===undefined?null:globalThis.__ax_result)});"
        ))
        if logs and isinstance(payload, dict):
            payload["logs"] = logs
        if analysis is not None and isinstance(payload, dict):
            payload["analysis"] = analysis
        return payload

    def _snap(self):
        try:
            return json.loads(self.ctx.eval("axSnap();"))
        except Exception:
            return {}

    def inspect_globals(self, options=None):
        return self._snap()

    def _entries(self):
        # TS's AxJSRuntime snapshot entries of the user globals (the names
        # present before the agent's code ran are skipped).
        try:
            return json.loads(self.ctx.eval("__ax_inspect_entries(Object.keys(globalThis.__ax_reserved||{}))"))
        except Exception:
            return []

    def snapshot_globals(self, options=None):
        g = self._snap()
        return {"version": 1, "entries": self._entries(), "bindings": g, "globals": g, "closed": self.closed}

    def patch_globals(self, snapshot, options=None):
        snap = snapshot or {}
        if snap.get("merge"):
            # The executor phase: the distiller's final no longer keeps evidence.
            self.ctx.eval("globalThis.__ax_phase='executor'")
        for key, value in (snap.get("bindings") or snap.get("globals") or {}).items():
            self.ctx.eval("globalThis[%s]=JSON.parse(%s);" % (json.dumps(key), json.dumps(json.dumps(value))))
        self.closed = bool(snap.get("closed", False))
        return self.snapshot_globals(options or {})

    def export_state(self, options=None):
        return self.snapshot_globals(options or {})

    def restore_state(self, snapshot, options=None):
        return self.patch_globals(snapshot or {}, options or {})

    def close(self):
        self.closed = True
        self.ctx = None
        return {"closed": True}


class AxQuickJsCodeRuntime(AxCodeRuntime):
    language = "JavaScript"

    def __init__(self):
        import quickjs

        self._quickjs = quickjs
        self.host_callables = {}

    def register_callable(self, name, handler):
        self.host_callables[name] = handler
        return self

    def get_usage_instructions(self) -> str:
        return _USAGE_INSTRUCTIONS

    def create_session(self, globals: dict[str, Any], options: dict[str, Any] | None = None):
        return AxQuickJsCodeSession(self, globals, options)
