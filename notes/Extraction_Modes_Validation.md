# Extraction Modes Validation Summary

This document summarizes the validation of the two extraction mechanisms in the Ax DSP system and how the recent fixes work correctly in both modes.

## Two Extraction Modes

### 1. Key-Value Format (`hasComplexFields = false`)

**When it's used:**
- Simple fields (string, number, boolean)
- Arrays of simple types
- Arrays of objects (with special handling)

**LLM Output Format:**
```
Field Name 1: value1
Field Name 2: value2
Array Field: ["item1", "item2"]
```

**Extraction Mechanism:**
- Uses `streamingExtractValues` to parse field prefixes (`Field Name:`)
- Extracts values after each prefix
- For arrays: tries JSON first, falls back to markdown list parsing
- For object arrays: parses each markdown list item as JSON (NEW FIX)

**Example:**
```typescript
const signature = f()
  .input('query', f.string())
  .output('items', f.string().array())
  .build();

// LLM outputs:
// Items:
// - apple
// - banana
```

### 2. JSON Format (`hasComplexFields = true`)

**When it's used:**
- When signature has object fields (non-array)
- When signature has array of objects fields
- When `useStructuredOutputs()` is explicitly called

**LLM Output Format:**
```json
{
  "field1": "value1",
  "field2": {"nested": "object"},
  "arrayField": [{"id": 1}, {"id": 2}]
}
```

**Extraction Mechanism:**
- Uses `parsePartialJson` in `processResponse.ts`
- Parses streaming JSON output
- Validates structured outputs against schema

**Example:**
```typescript
const signature = f()
  .input('query', f.string())
  .output('result', f.object({ name: f.string() }))
  .build();

// hasComplexFields() returns true
// LLM outputs pure JSON
```

## Fixes Applied

### 1. Enhanced Array Parsing for Object Arrays

**Location:** `extract.ts` - `validateAndParseFieldValue`

**What it does:**
- When parsing array items that should be objects/json, tries to parse each item as JSON
- Calls `extractBlock` to extract JSON from code blocks (e.g., \`\`\`json {...} \`\`\`)
- Only applies to `object` and `json` types, NOT to `string` types

**Code:**
```typescript
if (
  typeof v === 'string' &&
  (field.type?.name === 'object' ||
    (field.type?.name as string) === 'json')
) {
  try {
    const jsonText = extractBlock(v);
    v = JSON.parse(jsonText);
  } catch {
    // Ignore parsing errors
  }
}
```

**Why it works in both modes:**
- **Key-value mode:** Handles markdown lists where each item is a JSON object string
- **JSON mode:** Not used (JSON mode uses `parsePartialJson` instead)

### 2. Updated `extractBlock` Regex

**Location:** `extract.ts` - `extractBlock`

**What it does:**
- Changed regex from `/```([A-Za-z]*)\n([\s\S]*?)\n```/g` to `/```([A-Za-z]*)\s*([\s\S]*?)\s*```/g`
- Now supports single-line code blocks (e.g., \`\`\`json {...} \`\`\`)

**Why this was needed:**
- `parseMarkdownList` enforces single-line list items
- Multi-line code blocks would trigger "mixed content detected" error
- Single-line code blocks are more natural for LLM output in markdown lists

### 3. Structured Output Features

**Location:** `sig.ts`, `prompt.ts`

**What it does:**
- Added `useStructuredOutputs()` method to force JSON mode
- Updated prompts to render examples as JSON when complex fields are enabled
- Updated error correction prompts to request full JSON for complex fields

**How it affects extraction:**
- Sets `_forceComplexFields` flag on signature
- Triggers JSON mode in `processResponse.ts`
- LLM outputs pure JSON instead of key-value format

## Behavior Matrix

| Field Type | hasComplexFields | Extraction Mode | Example LLM Output |
|------------|------------------|-----------------|-------------------|
| `string` | false | Key-Value | `Name: John` |
| `string[]` | false | Key-Value | `Items:\n- apple\n- banana` |
| `object` | **true** | JSON | `{"name": "test", "age": 30}` |
| `object[]` | **true** | JSON | `[{"id": 1}, {"id": 2}]` |
| Any with `useStructuredOutputs()` | **true** | JSON | `{"field1": "value"}` |

## Test Coverage

### `extraction_modes_validation.test.ts`
- ✅ Simple strings in key-value format
- ✅ Multiple fields in key-value format
- ✅ Arrays with JSON in key-value format
- ✅ Arrays with markdown lists in key-value format
- ✅ Object arrays with JSON strings in markdown lists
- ✅ Structured outputs flag behavior
- ✅ Object fields trigger complex mode
- ✅ Array of objects extraction
- ✅ Top-level array output
- ✅ Code blocks in string arrays (preserved as-is)
- ✅ Backward compatibility for simple types

### `verification_fixes.test.ts`
- ✅ Markdown list of JSON strings for object arrays
- ✅ Markdown list of JSON strings for json arrays
- ✅ Handling invalid JSON gracefully

### `structured_output_features.test.ts`
- ✅ `useStructuredOutputs()` sets complex fields flag
- ✅ Examples rendered as JSON when structured outputs enabled
- ✅ Error correction requests full JSON for complex fields

### `extract.test.ts` (Existing Tests)
- ✅ All 19 existing tests pass
- ✅ No regressions

## Key Insights

1. **Object fields always trigger JSON mode**: Individual object fields (not arrays) set `hasComplexFields=true`, so the LLM outputs JSON, not key-value format.

2. **String arrays preserve code blocks**: For string arrays, code block syntax is preserved. JSON extraction only happens for `object` and `json` types.

3. **Array of objects works in key-value mode**: While individual objects trigger JSON mode, arrays of objects can work in key-value mode through markdown lists where each item is a JSON string.

4. **Two separate parsing paths**: 
   - **Key-value**: `streamingExtractValues` → `validateAndParseFieldValue`
   - **JSON**: `parsePartialJson` (in `processResponse.ts`)

5. **The fixes are backward compatible**: All existing tests pass, and the new behavior only affects edge cases that previously threw errors.
