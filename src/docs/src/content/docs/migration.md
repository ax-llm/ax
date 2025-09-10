---
title: "Migration Guide"
description: "Complete migration guide for Ax v13.0.24+ API changes"
---

# Migration Guide: Ax v13.0.24+ API Changes

This document provides comprehensive migration instructions for Ax v14.0.0+ API
changes. The framework introduces significant improvements for better type
safety, performance, and consistency.

## Overview of Changes

**Version 14.0.0+** deprecates several patterns that will be **completely
removed in v15.0.0**:

1. **Template literal syntax** for signatures and generators
2. **Constructor-based API** for core classes
3. **Legacy classes** like `AxChainOfThought` and `AxRAG`

**Important**: The `f.<type>()` field helper functions are **NOT deprecated** -
they remain available in the fluent signature creation API
(`f().input().output().build()`).

## What's Deprecated vs What's Not

### ❌ Deprecated (will be removed in v15.0.0)

1. **Template literal functions**:
   - `` ax`template` `` → Use `ax('string')`
   - `` s`template` `` → Use `s('string')`

2. **Constructor-based classes**:
   - `new AxAI()` → Use `ai()` factory function
   - `new AxAgent()` → Use `agent()` factory function
   - `new AxFlow()` → Use `flow()` static method
   - `new AxSignature()` → Use `s()` function or `AxSignature.create()`

3. **Legacy classes**:
   - `AxChainOfThought` → Use modern thinking models (o1, etc.)
   - `AxRAG` → Use `axRAG()` function built on AxFlow

### ✅ Still Available (NOT deprecated)

1. **Field helper functions in fluent API**:
   - `f.string()`, `f.number()`, `f.class()`, etc. - still work in fluent
     signatures
   - `f().input().output().build()` pattern remains fully supported

2. **All current functionality** - just accessed through new patterns

## Detailed Migration Instructions

### 1. AI Instance Creation

```typescript
// ❌ DEPRECATED: Constructor
const ai = new AxAI({ name: "openai", apiKey: "..." });

// ✅ CURRENT: Factory function
const llm = ai({ name: "openai", apiKey: "..." });
```

**Why migrate**: Factory functions provide better type inference and
consistency.

### 2. Signature Creation

#### String-Based Signatures (Recommended)

```typescript
// ❌ DEPRECATED: Template literal
const sig = s`input:string -> output:string`;

// ✅ CURRENT: Function call
const sig = s("input:string -> output:string");
```

#### Fluent API (Still Fully Supported)

```typescript
// ✅ CURRENT: Fluent API with f.<type>() helpers
const sig = f()
  .input("userMessage", f.string("User input"))
  .input("context", f.string("Background context").optional())
  .output("response", f.string("Generated response"))
  .output(
    "sentiment",
    f.class(["positive", "negative", "neutral"], "Sentiment"),
  )
  .build();
```

#### Static Methods (Alternative)

```typescript
// ✅ CURRENT: Static method
const sig = AxSignature.create("input:string -> output:string");
```

### 3. Generator Creation

```typescript
// ❌ DEPRECATED: Template literal
const gen = ax`input:string -> output:string`;

// ✅ CURRENT: Function call
const gen = ax("input:string -> output:string");
```

### 4. Agent Creation

```typescript
// ❌ DEPRECATED: Constructor
const agent = new AxAgent({
  name: "helper",
  signature: sig,
  ai: llm,
});

// ✅ CURRENT: Factory function
const agentInstance = agent({
  name: "helper",
  signature: sig,
  ai: llm,
});

// ✅ ALTERNATIVE: Static method
const agentInstance = AxAgent.create({
  name: "helper",
  signature: sig,
  ai: llm,
});
```

### 5. Flow Creation

```typescript
// ❌ DEPRECATED: Constructor
const flow = new AxFlow();

// ✅ CURRENT: Static method or direct instantiation
const flow = AxFlow.create();
// OR continue using: new AxFlow() (constructors work for AxFlow)
```

### 6. RAG Usage

```typescript
// ❌ DEPRECATED: AxRAG class
const rag = new AxRAG({ ai: llm, db: vectorDb });

// ✅ CURRENT: axRAG function (AxFlow-based)
const rag = axRAG({ ai: llm, db: vectorDb });
```

## Field Type Reference

### String-Based Field Syntax

When using `s()` or `ax()` functions, use string-based field definitions:

| Type               | Syntax                                   | Example                                           |
| ------------------ | ---------------------------------------- | ------------------------------------------------- |
| **String**         | `field:string "description"`             | `userInput:string "User question"`                |
| **Number**         | `field:number "description"`             | `score:number "Confidence 0-1"`                   |
| **Boolean**        | `field:boolean "description"`            | `isValid:boolean "Is input valid"`                |
| **JSON**           | `field:json "description"`               | `metadata:json "Extra data"`                      |
| **Arrays**         | `field:type[] "description"`             | `tags:string[] "Keywords"`                        |
| **Optional**       | `field?:type "description"`              | `context?:string "Optional context"`              |
| **Classification** | `field:class "opt1, opt2" "description"` | `category:class "urgent, normal, low" "Priority"` |
| **Date**           | `field:date "description"`               | `dueDate:date "Due date"`                         |
| **DateTime**       | `field:datetime "description"`           | `timestamp:datetime "Event time"`                 |
| **Code**           | `field:code "description"`               | `script:code "Python code"`                       |
| **Media**          | `field:image/audio/file/url`             | `photo:image "Profile picture"`                   |

### Fluent API Field Helpers (Still Available)

When using the fluent API with `f().input().output().build()`, all field helpers
remain available:

```typescript
const sig = f()
  .input("text", f.string("Input text"))
  .input("options", f.array(f.string("Option")).optional())
  .input("metadata", f.json("Extra data"))
  .output("result", f.string("Processed result"))
  .output("category", f.class(["A", "B", "C"], "Classification"))
  .output("confidence", f.number("Confidence score"))
  .build();
```

## Complete Migration Examples

### Example 1: Simple Text Processing

```typescript
// ❌ DEPRECATED
const ai = new AxAI({ name: "openai", apiKey: "..." });
const gen = ax`text:string -> summary:string`;
const result = await gen.forward(ai, { text: "Long text..." });

// ✅ CURRENT
const llm = ai({ name: "openai", apiKey: "..." });
const gen = ax("text:string -> summary:string");
const result = await gen.forward(llm, { text: "Long text..." });
```

### Example 2: Complex Agent

```typescript
// ❌ DEPRECATED
const ai = new AxAI({ name: "openai", apiKey: "..." });
const sig = s`question:string -> answer:string, confidence:number`;
const agent = new AxAgent({
  name: "assistant",
  signature: sig,
  ai: ai,
});

// ✅ CURRENT
const llm = ai({ name: "openai", apiKey: "..." });
const sig = s("question:string -> answer:string, confidence:number");
const agentInstance = agent({
  name: "assistant",
  signature: sig,
  ai: llm,
});
```

### Example 3: RAG Pipeline

```typescript
// ❌ DEPRECATED
const ai = new AxAI({ name: "openai", apiKey: "..." });
const rag = new AxRAG({ ai, db: vectorDb });

// ✅ CURRENT
const llm = ai({ name: "openai", apiKey: "..." });
const rag = axRAG({ ai: llm, db: vectorDb });
```

## Automated Migration

For large codebases, you can use find-and-replace patterns to automate
migration:

### Template Literal Migration

```bash
# Replace ax template literals
find . -name "*.ts" -exec sed -i 's/ax`\([^`]*\)`/ax("\1")/g' {} \;

# Replace s template literals  
find . -name "*.ts" -exec sed -i 's/s`\([^`]*\)`/s("\1")/g' {} \;
```

### Constructor Migration

```bash
# Replace AxAI constructor
find . -name "*.ts" -exec sed -i 's/new AxAI(/ai(/g' {} \;

# Replace AxAgent constructor
find . -name "*.ts" -exec sed -i 's/new AxAgent(/agent(/g' {} \;

# Replace AxRAG constructor  
find . -name "*.ts" -exec sed -i 's/new AxRAG(/axRAG(/g' {} \;
```

### Import Updates

```bash
# Update imports to include factory functions
find . -name "*.ts" -exec sed -i 's/import { AxAI }/import { ai }/g' {} \;
find . -name "*.ts" -exec sed -i 's/import { AxAgent }/import { agent }/g' {} \;
```

## Benefits of Migration

### 1. Better Type Safety

- Full TypeScript inference for all field types
- Exact literal type inference for class fields
- Compile-time validation of signatures

### 2. Improved Performance

- No template literal processing overhead
- Faster signature parsing
- Reduced runtime validation

### 3. Cleaner Syntax

- More readable and consistent API patterns
- Better IntelliSense support
- Enhanced auto-completion

### 4. Future-Proof Architecture

- Aligned with framework's long-term vision
- Consistent patterns across all APIs
- Better extensibility for new features

## Timeline

- **v13.0.24+**: Deprecated patterns still work but show warnings
- **v15.0.0**: Deprecated patterns will be completely removed
- **Recommendation**: Migrate as soon as possible to take advantage of
  improvements

## Common Migration Issues

### Issue 1: Template Literal Field Interpolation

```typescript
// ❌ PROBLEMATIC: Complex template literals
const dynamicType = "string";
const sig = s`input:${dynamicType} -> output:string`;

// ✅ SOLUTION: Use fluent API for dynamic fields
const sig = f()
  .input("input", f[dynamicType as keyof typeof f](https://github.com/ax-llm/ax/blob/main/"Input field"))
  .output("output", f.string("Output field"))
  .build();
```

### Issue 2: Variable Naming Conflicts

```typescript
// ❌ PROBLEMATIC: Variable name conflicts
const ai = ai({ name: "openai", apiKey: "..." }); // ai conflicts with function name

// ✅ SOLUTION: Use recommended naming
const llm = ai({ name: "openai", apiKey: "..." }); // Clear naming
```

### Issue 3: Import Statement Updates

```typescript
// ❌ OLD: Constructor imports
import { AxAgent, AxAI } from "@ax-llm/ax";

// ✅ NEW: Factory function imports
import { agent, ai } from "@ax-llm/ax";
```

## Need Help?

If you encounter issues during migration:

1. Check the [examples directory](https://github.com/ax-llm/ax/blob/main/src/examples/) for updated patterns
2. Refer to the main [README.md](/readme/) for current API usage
3. Join our [Discord community](https://discord.gg/DSHg3dU7dW) for support
4. Open an issue on [GitHub](https://github.com/ax-llm/ax/issues)

## Summary

The v13.0.24+ migration primarily involves:

1. **Replace template literals** with function calls: `` ax`...` `` →
   `ax('...')`
2. **Replace constructors** with factory functions: `new AxAI()` → `ai()`
3. **Update variable names** to avoid conflicts: Use `llm` instead of `ai`
4. **Update imports** to include new factory functions

The `f.<type>()` field helper functions remain fully supported in the fluent API
and are **not deprecated**.

All deprecated patterns will be removed in v15.0.0, so migrate as soon as
possible to ensure compatibility and take advantage of the improved type safety
and performance.
