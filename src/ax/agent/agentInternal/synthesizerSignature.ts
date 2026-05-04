import { type AxIField, f } from '../../dsp/sig.js';

/**
 * Build the signature consumed by the **finalResponder** stage:
 *   { ...nonContextInputs, contextData } -> outputFields
 *
 * `contextData` is the reshape of the upstream actor's `final(task, evidence)`
 * payload (see `buildResponderContextData`). Output fields are the agent's
 * own user-facing outputs.
 */
export function buildFinalResponderSignature(
  nonContextInputs: readonly AxIField[],
  outputFields: readonly AxIField[]
) {
  return f()
    .addInputFields(nonContextInputs)
    .input(
      'contextData',
      f.json('Context data to help synthesize the final answer.')
    )
    .addOutputFields(outputFields)
    .build();
}
