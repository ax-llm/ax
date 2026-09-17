import type { AxChatRequest } from '../ai/types.js';
import type { AxField, AxFieldType } from './sig.js';

/** @internal Keep original value guidance outside vendor JSON Schema documents. */
export function outputValueDescriptions(
  fields: readonly AxField[]
): NonNullable<AxChatRequest['responseFormat']>['fieldDescriptions'] {
  const entries = fields
    .filter(
      (field) =>
        !field.isInternal &&
        field.type?.valueDescriptions &&
        Object.keys(field.type.valueDescriptions).length > 0
    )
    .map((field) => [
      field.name,
      {
        description: field.description,
        valueDescriptions: { ...field.type!.valueDescriptions! },
      },
    ]);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

/** @internal Value guidance is independent of provider-specific decision policies. */
export function validateValueDescriptions(
  type: string,
  descriptions: Readonly<Record<string, string>> | undefined,
  options?: readonly string[],
  fieldName = type
): void {
  if (descriptions === undefined) return;
  if (
    !descriptions ||
    typeof descriptions !== 'object' ||
    Array.isArray(descriptions) ||
    (type !== 'boolean' && type !== 'class')
  )
    throw new Error(
      `Field "${fieldName}": value descriptions require a boolean or class field`
    );
  const allowed = type === 'boolean' ? ['true', 'false'] : (options ?? []);
  for (const [value, description] of Object.entries(descriptions)) {
    if (!allowed.includes(value))
      throw new Error(
        `Field "${fieldName}": unknown described value "${value}"`
      );
    if (typeof description !== 'string' || !description.trim())
      throw new Error(
        `Field "${fieldName}": description for "${value}" must be a nonempty string`
      );
  }
}

/** @internal Use declaration order, independent of annotation insertion order. */
export function orderedValueDescriptions(type: {
  name: string;
  options?: readonly string[];
  valueDescriptions?: Readonly<Record<string, string>>;
}): [string, string][] {
  const keys =
    type.name === 'boolean' ? ['true', 'false'] : (type.options ?? []);
  return keys.flatMap((key) =>
    type.valueDescriptions && Object.hasOwn(type.valueDescriptions, key)
      ? [[key, type.valueDescriptions[key]!] as [string, string]]
      : []
  );
}

/** @internal Shared plain-text rendering for prompts and standard JSON schemas. */
export function describeFieldValues(
  field: Readonly<AxField>
): string | undefined {
  const values = field.type ? orderedValueDescriptions(field.type) : [];
  if (!values.length) return field.description;
  return [
    field.description,
    ...values.map(([value, description]) => `${value}: ${description}`),
  ]
    .filter((part) => part !== undefined && part !== '')
    .join('\n');
}

/** @internal Include nested value guidance in prompts that show only an object shape. */
export function describeNestedFieldValues(
  fields?: Readonly<Record<string, AxFieldType>>,
  prefix = ''
): string[] {
  return Object.entries(fields ?? {}).flatMap(([name, type]) => {
    const path = prefix ? `${prefix}.${name}` : name;
    return [
      ...orderedValueDescriptions({ ...type, name: type.type }).map(
        ([value, description]) => `${path} = ${value}: ${description}`
      ),
      ...describeNestedFieldValues(type.fields, path),
    ];
  });
}
