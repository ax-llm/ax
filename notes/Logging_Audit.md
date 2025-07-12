# Ax Logger System Refactoring Summary

## Overview

The Ax logging system has been refactored to use typed objects instead of string
formatting with hardcoded headers. This provides better structure, type safety,
and flexibility for different rendering implementations.

## Key Changes

### 1. New Typed Logger Data Types

Added `AxLoggerData` union type in `src/ax/ai/types.ts`:

```typescript
export type AxLoggerData =
  | {
    name: "ChatRequestChatPrompt";
    index: number;
    value: AxChatRequest["chatPrompt"];
  }
  | { name: "FunctionResults"; value: AxFunctionResult[] }
  | { name: "ChatResponseResults"; value: AxChatResponseResult[] }
  | { name: "ChatResponseStreamingResult"; value: string }
  | {
    name: "ChatResponseStreamingResultDelta";
    index: number;
    value: AxChatResponseResult & { delta?: string };
  }
  | {
    name: "FunctionError";
    index: number;
    fixingInstructions: string;
    error: unknown;
  }
  | {
    name: "ValidationError";
    index: number;
    fixingInstructions: string;
    error: unknown;
  }
  | {
    name: "AssertionError";
    index: number;
    fixingInstructions: string;
    error: unknown;
  }
  | { name: "Notification"; id: string; value: string };
```

### 2. Updated Logger Function Signature

Modified `AxLoggerFunction` to accept both strings and typed data:

```typescript
export type AxLoggerFunction = (
  message: string | AxLoggerData,
  options?: { tags?: AxLoggerTag[] },
) => void;
```

### 3. Refactored Debug Functions

Updated `src/ax/ai/debug.ts` to emit typed objects instead of formatted strings:

**Before:**

```typescript
logChatRequest(chatPrompt, hideSystemPrompt, logger) => {
  // String formatting with hardcoded headers like "─── User: ───"
}
```

**After:**

```typescript
logChatRequest(chatPrompt, index, hideSystemPrompt, logger) => {
  const loggerData: AxLoggerData = {
    name: 'ChatRequestChatPrompt',
    index,
    value: filteredPrompt,
  };
  logger(loggerData);
}
```

### 4. Enhanced Logger Implementations

Updated logger functions in `src/ax/dsp/loggers.ts` to handle both string and
typed data:

- `axCreateDefaultColorLogger()` - Renders typed data with colors
- `axCreateDefaultTextLogger()` - Renders typed data without colors
- `axCreateOptimizerLogger()` - Delegates typed data to base logger

### 5. New Debug Functions

Added new typed logging functions:

- `logResponseStreamingDelta()` - For streaming response deltas
- `logFunctionError()` - For function execution errors
- `logValidationError()` - For validation errors
- `logAssertionError()` - For assertion errors
- `logNotification()` - For system notifications

## Benefits

1. **Type Safety**: Structured data with TypeScript types
2. **Flexibility**: Renderers can format data however they want
3. **Extensibility**: Easy to add new log data types
4. **Consistency**: Standardized structure across all logging
5. **Better Tooling**: IntelliSense and type checking for log data

## Migration Guide

### For Logger Implementers

Custom loggers now need to handle both strings and typed data:

```typescript
const customLogger: AxLoggerFunction = (message, options) => {
  if (typeof message === "string") {
    // Handle traditional string messages
    process.stdout.write(message);
  } else {
    // Handle typed logger data
    switch (message.name) {
      case "ChatRequestChatPrompt":
        // Custom rendering for chat requests
        break;
      case "ChatResponseResults":
        // Custom rendering for responses
        break;
        // ... handle other types
    }
  }
};
```

### For Debug Function Users

No changes needed - the debug functions maintain the same API but now emit
structured data.

## Example Usage

See `src/examples/debug-logging.ts` for a complete example of:

- Creating custom loggers that handle typed data
- Different rendering strategies for each data type
- Backwards compatibility with string-based logging

## Files Modified

1. `src/ax/ai/types.ts` - Added `AxLoggerData` types
2. `src/ax/ai/debug.ts` - Refactored to emit typed objects
3. `src/ax/dsp/loggers.ts` - Updated renderers for typed data
4. `src/ax/ai/base.ts` - Fixed logger function calls
5. `src/ax/ai/multiservice.ts` - Updated fallback logger
6. `src/ax/ai/mock/api.ts` - Updated mock logger
7. `src/examples/debug-logging.ts` - Example of new system

## Backwards Compatibility

The system maintains full backwards compatibility:

- Existing string-based logging continues to work
- All existing logger implementations are updated to handle both types
- No breaking changes to public APIs

## Status

✅ Type definitions added ✅ Debug functions refactored\
✅ Logger implementations updated ✅ Example created ✅ All TypeScript errors
resolved (except unrelated optimizer syntax error)
