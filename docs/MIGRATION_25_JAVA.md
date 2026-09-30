# Java changes in Ax 25

`addFieldProcessor(field, (value, context) -> ...)` sends feedback to the model by default. A non-empty result requests another step; return null when satisfied. Use `addFieldTransform` for local rewriting. The old string-operation and single-argument callback overloads of `addFieldProcessor` are removed. Explicit `AxFieldProcessorMode.TRANSFORM` remains available.

Chat and embed now throw `AxAIServiceNetworkError` or `AxAIServiceTimeoutError` for transport failures, retaining the JDK exception through `getCause()`. Catch the Ax type when classifying failures. Explicit `typedTransportErrors: false` retains legacy JDK exceptions during migration.
