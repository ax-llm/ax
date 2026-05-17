import type { AxFunctionJSONSchema } from '../ai/types.js';
import type {
  AxAgentFunction,
  AxAgentFunctionCollection,
  AxAgentFunctionExample,
  AxAgentFunctionGroup,
  AxAgentFunctionModuleMeta,
  AxAnyAgentic,
  NormalizedAgentFunctionCollection,
} from './AxAgent.js';

function isAgentic(value: unknown): value is AxAnyAgentic {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as { getFunction?: unknown }).getFunction === 'function'
  );
}

/**
 * Returns a copy of `schema` with the listed property names removed from
 * both `properties` and `required`.  Used to strip parent-injected shared
 * fields from a child agent's public function signature.
 */
export function stripSchemaProperties(
  schema: AxFunctionJSONSchema,
  namesToRemove: ReadonlySet<string>
): AxFunctionJSONSchema {
  if (!schema.properties || namesToRemove.size === 0) return schema;
  const properties = Object.fromEntries(
    Object.entries(schema.properties).filter(([k]) => !namesToRemove.has(k))
  );
  const required = schema.required?.filter((k) => !namesToRemove.has(k));
  return {
    ...schema,
    properties,
    ...(required !== undefined ? { required } : {}),
  };
}

export type DiscoveryCallableMeta = {
  module: string;
  name: string;
  description?: string;
  parameters?: AxFunctionJSONSchema;
  returns?: AxFunctionJSONSchema;
  examples?: readonly AxAgentFunctionExample[];
};

export function normalizeAgentModuleNamespace(
  namespace: string,
  options?: Readonly<{ normalize?: boolean }>
): string {
  const trimmed = namespace.trim();
  const shouldNormalize = options?.normalize ?? true;
  const normalized = shouldNormalize ? toCamelCase(trimmed) : trimmed;
  if (!normalized) {
    throw new Error('Agent module namespace must contain letters or numbers');
  }
  return normalized;
}

function isAgentFunctionGroup(
  value: AxAgentFunction | AxAgentFunctionGroup
): value is AxAgentFunctionGroup {
  return Array.isArray((value as AxAgentFunctionGroup).functions);
}

export function normalizeAgentFunctionCollection(
  collection: AxAgentFunctionCollection | undefined,
  reservedNames: ReadonlySet<string>
): NormalizedAgentFunctionCollection {
  if (!collection || collection.length === 0) {
    return { functions: [], moduleMetadata: [], agents: [] };
  }

  // First pass: split out agentic entries (anything with `.getFunction()`)
  // from the rest. Agents convert to AxAgentFunction so they share the same
  // namespacing, prompt rendering, and runtime injection as regular functions.
  const remaining: (AxAgentFunction | AxAgentFunctionGroup)[] = [];
  const agents: AxAnyAgentic[] = [];
  const agentFunctions: AxAgentFunction[] = [];
  for (const item of collection as readonly (
    | AxAgentFunction
    | AxAgentFunctionGroup
    | AxAnyAgentic
  )[]) {
    if (isAgentic(item)) {
      const fn = item.getFunction();
      agents.push(item);
      agentFunctions.push({
        ...fn,
        _kind: 'internal',
      } as AxAgentFunction);
    } else {
      remaining.push(item as AxAgentFunction | AxAgentFunctionGroup);
    }
  }

  if (remaining.length === 0) {
    return { functions: agentFunctions, moduleMetadata: [], agents };
  }

  const allGroups = remaining.every((item) =>
    isAgentFunctionGroup(item as AxAgentFunction | AxAgentFunctionGroup)
  );
  const allFunctions = remaining.every(
    (item) =>
      !isAgentFunctionGroup(item as AxAgentFunction | AxAgentFunctionGroup)
  );

  if (!allGroups && !allFunctions) {
    throw new Error(
      'Agent functions collections must contain either flat functions or grouped function modules, not both'
    );
  }

  if (allFunctions) {
    return {
      functions: [
        ...agentFunctions,
        ...(remaining as readonly AxAgentFunction[]),
      ],
      moduleMetadata: [],
      agents,
    };
  }

  const seenNamespaces = new Set<string>();
  const moduleMetadata: AxAgentFunctionModuleMeta[] = [];
  const functions: AxAgentFunction[] = [...agentFunctions];

  for (const group of remaining as readonly AxAgentFunctionGroup[]) {
    const namespace = group.namespace.trim();
    const title = group.title.trim();
    const selectionCriteria = group.selectionCriteria?.trim() || undefined;
    const description = group.description?.trim() || undefined;
    const alwaysInclude = group.alwaysInclude === true;

    if (!namespace) {
      throw new Error(
        'Agent function group namespace must be a non-empty string'
      );
    }
    if (!title) {
      throw new Error(
        `Agent function group "${namespace}" must define a non-empty title`
      );
    }
    if (reservedNames.has(namespace)) {
      throw new Error(
        `Agent function namespace "${namespace}" conflicts with an AxAgent runtime global and is reserved`
      );
    }
    if (seenNamespaces.has(namespace)) {
      throw new Error(
        `Duplicate agent function group namespace "${namespace}"`
      );
    }
    if (group.functions.length === 0) {
      throw new Error(
        `Agent function group "${namespace}" must contain at least one function`
      );
    }

    seenNamespaces.add(namespace);
    moduleMetadata.push({
      namespace,
      title,
      selectionCriteria,
      description,
      ...(alwaysInclude ? { alwaysInclude } : {}),
    });

    for (const fn of group.functions) {
      if ('namespace' in fn && fn.namespace !== undefined) {
        throw new Error(
          `Grouped agent function "${namespace}.${fn.name}" must not define namespace; use the parent group namespace instead`
        );
      }

      functions.push({
        ...fn,
        namespace,
        ...(alwaysInclude ? { _alwaysInclude: true } : {}),
      });
    }
  }

  return { functions, moduleMetadata, agents };
}

export function normalizeDiscoveryStringInput(
  value: unknown,
  fieldName: string
): string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new Error(`${fieldName} must be a non-empty string`);
    }
    return [trimmed];
  }

  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be a string or string[]`);
  }

  if (!value.every((item) => typeof item === 'string')) {
    throw new Error(`${fieldName} must contain only strings`);
  }

  const normalized = value
    .map((item) => item as string)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (normalized.length === 0) {
    throw new Error(`${fieldName} must contain at least one non-empty string`);
  }

  return [...new Set(normalized)];
}

export function compareCanonicalDiscoveryStrings(
  left: string,
  right: string
): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

export function sortDiscoveryModules(modules: readonly string[]): string[] {
  return [...modules].sort(compareCanonicalDiscoveryStrings);
}

export function normalizeDiscoveryCallableIdentifier(
  identifier: string
): string {
  const trimmed = identifier.trim();
  return trimmed.includes('.') ? trimmed : `utils.${trimmed}`;
}

export function normalizeAndSortDiscoveryFunctionIdentifiers(
  identifiers: readonly string[]
): string[] {
  return [
    ...new Set(
      identifiers.map((identifier) =>
        normalizeDiscoveryCallableIdentifier(identifier)
      )
    ),
  ].sort(compareCanonicalDiscoveryStrings);
}

export function resolveDiscoveryCallableNamespaces(
  identifiers: readonly string[],
  callableLookup: ReadonlyMap<string, DiscoveryCallableMeta>
): string[] {
  const namespaces = new Set<string>();

  for (const rawIdentifier of identifiers) {
    const qualifiedName = normalizeDiscoveryCallableIdentifier(rawIdentifier);
    const meta = callableLookup.get(qualifiedName);
    if (meta) {
      namespaces.add(meta.module);
    }
  }

  return [...namespaces];
}

function normalizeSchemaTypesForDiscovery(
  schema: AxFunctionJSONSchema
): string[] {
  const rawType = (schema as { type?: unknown }).type;
  if (Array.isArray(rawType)) {
    return rawType.filter((t): t is string => typeof t === 'string');
  }
  if (typeof rawType === 'string') {
    if (rawType.includes(',')) {
      return rawType
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
    }
    return [rawType];
  }
  return [];
}

function isJsonAnyTypeUnionForDiscovery(types: readonly string[]): boolean {
  const normalized = new Set(types);
  return (
    normalized.has('object') &&
    normalized.has('array') &&
    normalized.has('string') &&
    normalized.has('number') &&
    normalized.has('boolean') &&
    normalized.has('null')
  );
}

function schemaTypeToShortStringForDiscovery(
  schema: AxFunctionJSONSchema
): string {
  if (schema.enum) return schema.enum.map((e) => `"${e}"`).join(' | ');

  const types = normalizeSchemaTypesForDiscovery(schema);
  if (types.length === 0) return 'unknown';
  if (isJsonAnyTypeUnionForDiscovery(types)) return 'any';

  const rendered = [...new Set(types)].map((type) => {
    if (type === 'array') {
      const itemType = schema.items
        ? schemaTypeToShortStringForDiscovery(schema.items)
        : 'unknown';
      return itemType.includes(' | ') ? `(${itemType})[]` : `${itemType}[]`;
    }
    if (type === 'object') {
      if (schema.properties && Object.keys(schema.properties).length > 0) {
        return renderObjectTypeForDiscovery(schema);
      }
      return 'object';
    }
    return type;
  });

  return rendered.length > 1
    ? rendered.join(' | ')
    : (rendered[0] ?? 'unknown');
}

function renderObjectTypeForDiscovery(
  schema: AxFunctionJSONSchema | undefined,
  options?: Readonly<{ respectRequired?: boolean }>
): string {
  if (!schema) {
    return '{}';
  }

  const hasProperties =
    !!schema.properties && Object.keys(schema.properties).length > 0;
  const supportsExtraProps = schema.additionalProperties === true;

  if (!hasProperties) {
    return supportsExtraProps ? '{ [key: string]: unknown }' : '{}';
  }

  const required = new Set(schema.required ?? []);
  const respectRequired = options?.respectRequired ?? false;
  const parts = Object.entries(schema.properties!).map(([key, prop]) => {
    const typeStr = schemaTypeToShortStringForDiscovery(prop);
    const optionalMarker = respectRequired && !required.has(key) ? '?' : '';
    return `${key}${optionalMarker}: ${typeStr}`;
  });
  if (schema.additionalProperties === true) {
    parts.push('[key: string]: unknown');
  }

  return `{ ${parts.join(', ')} }`;
}

function renderCallableEntryForDiscovery(args: {
  qualifiedName: string;
  parameters?: AxFunctionJSONSchema;
  returns?: AxFunctionJSONSchema;
}): string {
  const paramType = renderObjectTypeForDiscovery(args.parameters, {
    respectRequired: true,
  });
  const returnType = args.returns
    ? `: Promise<${schemaTypeToShortStringForDiscovery(args.returns)}>`
    : '';
  return `- \`${args.qualifiedName}(args: ${paramType})${returnType}\``;
}

type DiscoveryArgDoc = {
  name: string;
  type: string;
  required?: boolean;
  description: string;
};

function collectDiscoveryArgumentDocs(
  schema: AxFunctionJSONSchema | undefined,
  prefix = '',
  includeRequired = true
): DiscoveryArgDoc[] {
  if (!schema?.properties) {
    return [];
  }

  const required = new Set(schema.required ?? []);
  const docs: DiscoveryArgDoc[] = [];

  for (const [key, prop] of Object.entries(schema.properties)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const description = prop.description?.trim();
    if (description) {
      docs.push({
        name: path,
        type: schemaTypeToShortStringForDiscovery(prop),
        required: includeRequired ? required.has(key) : undefined,
        description,
      });
    }

    const propTypes = normalizeSchemaTypesForDiscovery(prop);
    if (propTypes.includes('object') && prop.properties) {
      docs.push(...collectDiscoveryArgumentDocs(prop, path, false));
    }

    if (propTypes.includes('array') && prop.items) {
      const itemDescription = (
        prop.items as AxFunctionJSONSchema & { description?: string }
      ).description?.trim();
      const itemPath = `${path}[]`;
      if (itemDescription) {
        docs.push({
          name: itemPath,
          type: schemaTypeToShortStringForDiscovery(prop.items),
          description: itemDescription,
        });
      }
      const itemTypes = normalizeSchemaTypesForDiscovery(prop.items);
      if (itemTypes.includes('object') && prop.items.properties) {
        docs.push(...collectDiscoveryArgumentDocs(prop.items, itemPath, false));
      }
    }
  }

  return docs;
}

function renderDiscoveryArgumentDocsMarkdown(
  schema: AxFunctionJSONSchema | undefined
): string | undefined {
  const docs = collectDiscoveryArgumentDocs(schema);
  if (docs.length === 0) {
    return undefined;
  }

  return [
    '#### Arguments',
    ...docs.map((doc) => {
      const suffix =
        doc.required === undefined
          ? `\`${doc.type}\``
          : `\`${doc.type}\`, ${doc.required ? 'required' : 'optional'}`;
      return `- \`${doc.name}\` (${suffix}): ${doc.description}`;
    }),
  ].join('\n');
}

function renderDiscoveryExamplesMarkdown(
  examples: readonly AxAgentFunctionExample[] | undefined
): string | undefined {
  if (!examples || examples.length === 0) {
    return undefined;
  }

  const blocks = examples
    .map((example) => {
      const parts: string[] = [];
      if (example.title?.trim()) {
        parts.push(`##### ${example.title.trim()}`);
      }
      if (example.description?.trim()) {
        parts.push(example.description.trim());
      }
      parts.push(`\`\`\`${example.language?.trim() || 'typescript'}`);
      parts.push(example.code);
      parts.push('```');
      return parts.join('\n');
    })
    .join('\n\n');

  return ['#### Examples', blocks].join('\n');
}

export function renderDiscoveryModuleListMarkdown(
  modules: readonly string[],
  moduleLookup: ReadonlyMap<string, readonly string[]>,
  moduleMetaLookup: ReadonlyMap<string, AxAgentFunctionModuleMeta>
): string {
  return sortDiscoveryModules(modules)
    .map((module) => {
      const functions = [...(moduleLookup.get(module) ?? [])]
        .map((qualifiedName) => qualifiedName.split('.').pop() ?? qualifiedName)
        .sort(compareCanonicalDiscoveryStrings);
      const exists = functions.length > 0;
      const meta = exists ? moduleMetaLookup.get(module) : undefined;
      const body = exists
        ? functions.map((name) => `- \`${name}\``).join('\n')
        : `- Error: module \`${module}\` does not exist.`;
      const parts = [`### Module \`${module}\``];
      if (meta) {
        parts.push(`**${meta.title}**`);
      }
      parts.push(body);
      if (meta?.description) {
        parts.push(meta.description);
      }
      return parts.join('\n');
    })
    .join('\n\n');
}

export function renderDiscoveryFunctionDefinitionsMarkdown(
  identifiers: readonly string[],
  callableLookup: ReadonlyMap<string, DiscoveryCallableMeta>
): string {
  return normalizeAndSortDiscoveryFunctionIdentifiers(identifiers)
    .map((qualifiedName) => {
      const meta = callableLookup.get(qualifiedName);
      if (!meta) {
        return `### \`${qualifiedName}\`\n- Not found.`;
      }
      return [
        `### \`${qualifiedName}\``,
        meta.description,
        renderCallableEntryForDiscovery({
          qualifiedName,
          parameters: meta.parameters,
          returns: meta.returns,
        }),
        renderDiscoveryArgumentDocsMarkdown(meta.parameters),
        renderDiscoveryExamplesMarkdown(meta.examples),
      ]
        .filter((part): part is string => !!part)
        .join('\n');
    })
    .join('\n\n');
}

export function toCamelCase(inputString: string): string {
  const parts = inputString
    .trim()
    .split(/[^A-Za-z0-9_$]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return '';
  }

  return parts
    .map((part, index) => {
      const lower = part.toLowerCase();
      if (index === 0) {
        return lower;
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join('');
}
