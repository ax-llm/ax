import { type AxIField, f } from '../../dsp/sig.js';

/**
 * Build the signature consumed by the **responder** stage:
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

/**
 * The citations field carries its entire prompt contract in the description —
 * the responder already sees the `contextData.evidence` JSON, so no template
 * change is needed for the model to know the valid ids.
 */
const CITATIONS_FIELD_DESCRIPTION =
  'IDs of the evidence entries that directly support the answer: use the ' +
  'exact top-level keys of the contextData.evidence object, plus the `id` of ' +
  'any records inside it that were relied on (e.g. loaded memories). Cite ' +
  'only entries actually used. Leave empty when contextData.evidence is ' +
  'absent or was not needed.';

/**
 * Append the optional citations output field to the responder's output
 * fields. Throws when the user signature already declares the name — the
 * caller must pick a different `citations.field`.
 */
export function appendCitationsOutputField(
  outputFields: readonly AxIField[],
  fieldName: string
): AxIField[] {
  if (outputFields.some((field) => field.name === fieldName)) {
    throw new Error(
      `AxAgent: citations.field "${fieldName}" collides with an output field of the agent signature; pick a different citations.field.`
    );
  }
  return [
    ...outputFields,
    {
      name: fieldName,
      title: 'Evidence Citations',
      description: CITATIONS_FIELD_DESCRIPTION,
      type: { name: 'string', isArray: true },
      isOptional: true,
    },
  ];
}
