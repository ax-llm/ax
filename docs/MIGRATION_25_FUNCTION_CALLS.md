# Function-call validation in Ax 25

Generated Python, Go, Java, C++ and Rust programs now reject malformed model function calls before executing any tool, matching TypeScript. This applies to both ordinary responses and merged streaming responses.

Calls must be non-null objects with a nonempty string id, type `function`, a function object with a nonempty name, and optional parameters represented by a string or object. Invalid calls fail immediately with the TypeScript validation message; they do not trigger a correction request.

To retain the previous permissive behavior, explicitly pass `functionCallValidation: 'correct'` (or `function_call_validation: 'correct'`). Explicit `'fail'` remains supported. Unknown option values fail validation.
