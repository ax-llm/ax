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
 * The citations field carries its entire prompt contract in its description —
 * the responder already sees the `contextData.evidence` JSON, so no template
 * change is needed for the model to know the valid ids. The record-id clause
 * is included only when `includeMemoryIds` is on, so the prompt never invites
 * citations the validator will reject.
 */
function citationsFieldDescription(includeMemoryIds: boolean): string {
  const recordClause = includeMemoryIds
    ? ', plus the `id` of any records inside it that were relied on (e.g. loaded memories)'
    : '';
  return (
    'IDs of the evidence entries that directly support the answer: use the ' +
    `exact top-level keys of the contextData.evidence object${recordClause}. ` +
    'Cite only entries actually used. Leave empty when contextData.evidence ' +
    'is absent or was not needed.'
  );
}

/**
 * Append the optional citations output field to the responder's output
 * fields. Throws when the name collides with a user output field or the
 * reserved `contextData` input — the caller must pick a different
 * `citations.field`.
 */
export function appendCitationsOutputField(
  outputFields: readonly AxIField[],
  fieldName: string,
  includeMemoryIds: boolean
): AxIField[] {
  if (fieldName === 'contextData') {
    throw new Error(
      'AxAgent: citations.field cannot be "contextData" — it is the reserved responder evidence input; pick a different citations.field.'
    );
  }
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
      description: citationsFieldDescription(includeMemoryIds),
      type: { name: 'string', isArray: true },
      isOptional: true,
    },
  ];
}
