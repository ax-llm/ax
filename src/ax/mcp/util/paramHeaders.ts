import type { AxMCPJSONSchema } from '../types.js';
import { axMCPEncodeHeaderValue } from './headerValue.js';

const MCP_HEADER_ANNOTATION = 'x-mcp-header';
const HTTP_FIELD_NAME_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export interface AxMCPParamHeaderBinding {
  /** Full HTTP field name, including the MCP prefix. */
  headerName: string;
  /** Exact object-property path used to read the tool argument. */
  path: readonly string[];
  type: 'string' | 'integer' | 'boolean';
}

/** Raised when an `x-mcp-header` annotation makes a tool schema invalid. */
export class AxMCPParamHeaderSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AxMCPParamHeaderSchemaError';
  }
}

/** Validates and extracts every statically reachable parameter-header binding. */
export function axMCPParamHeaderBindings(
  inputSchema: Readonly<AxMCPJSONSchema>
): readonly AxMCPParamHeaderBinding[] {
  const bindings: AxMCPParamHeaderBinding[] = [];
  const names = new Set<string>();
  const visiting = new WeakSet<object>();

  const visit = (
    value: unknown,
    path: readonly string[],
    staticallyReachable: boolean,
    propertyNode: boolean,
    location: string
  ): void => {
    if (!value || typeof value !== 'object') return;
    if (visiting.has(value)) {
      throw new AxMCPParamHeaderSchemaError(
        `cyclic schema encountered at ${location}`
      );
    }
    visiting.add(value);

    if (Array.isArray(value)) {
      value.forEach((item, index) =>
        visit(item, path, false, false, `${location}[${index}]`)
      );
      visiting.delete(value);
      return;
    }

    const schema = value as Record<string, unknown>;
    if (Object.hasOwn(schema, MCP_HEADER_ANNOTATION)) {
      if (!staticallyReachable || !propertyNode) {
        throw new AxMCPParamHeaderSchemaError(
          `${MCP_HEADER_ANNOTATION} at ${location} is not statically reachable through properties`
        );
      }
      const name = schema[MCP_HEADER_ANNOTATION];
      if (typeof name !== 'string' || name.length === 0) {
        throw new AxMCPParamHeaderSchemaError(
          `${MCP_HEADER_ANNOTATION} at ${location} must be a non-empty string`
        );
      }
      if (!HTTP_FIELD_NAME_TOKEN.test(name)) {
        throw new AxMCPParamHeaderSchemaError(
          `${MCP_HEADER_ANNOTATION} value ${JSON.stringify(name)} at ${location} is not an RFC 9110 field-name token`
        );
      }
      const normalizedName = name.toLowerCase();
      if (names.has(normalizedName)) {
        throw new AxMCPParamHeaderSchemaError(
          `${MCP_HEADER_ANNOTATION} value ${JSON.stringify(name)} is not case-insensitively unique`
        );
      }
      const type = schema.type;
      if (type !== 'string' && type !== 'integer' && type !== 'boolean') {
        throw new AxMCPParamHeaderSchemaError(
          `${MCP_HEADER_ANNOTATION} at ${location} requires type string, integer, or boolean`
        );
      }
      names.add(normalizedName);
      bindings.push({ headerName: `Mcp-Param-${name}`, path: [...path], type });
    }

    const properties = schema.properties;
    if (
      properties &&
      typeof properties === 'object' &&
      !Array.isArray(properties)
    ) {
      for (const [name, child] of Object.entries(properties)) {
        visit(
          child,
          [...path, name],
          staticallyReachable,
          staticallyReachable,
          `${location}.properties.${name}`
        );
      }
    }

    for (const [keyword, child] of Object.entries(schema)) {
      if (keyword === 'properties' || keyword === MCP_HEADER_ANNOTATION) {
        continue;
      }
      if (child && typeof child === 'object') {
        visit(child, path, false, false, `${location}.${keyword}`);
      }
    }
    visiting.delete(value);
  };

  visit(inputSchema, [], true, false, 'inputSchema');
  return bindings;
}

/** Builds encoded `Mcp-Param-*` fields from validated tool arguments. */
export function axMCPBuildParamHeaders(
  inputSchema: Readonly<AxMCPJSONSchema>,
  args: unknown
): Readonly<Record<string, string>> {
  const headers: Array<readonly [string, string]> = [];
  for (const binding of axMCPParamHeaderBindings(inputSchema)) {
    const value = valueAtPath(args, binding.path);
    if (value === undefined || value === null) continue;
    let plain: string;
    if (binding.type === 'string') {
      if (typeof value !== 'string') throw invalidValue(binding, value);
      plain = value;
    } else if (binding.type === 'boolean') {
      if (typeof value !== 'boolean') throw invalidValue(binding, value);
      plain = value ? 'true' : 'false';
    } else {
      if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
        throw invalidValue(binding, value);
      }
      plain = String(value);
    }
    headers.push([binding.headerName, axMCPEncodeHeaderValue(plain)]);
  }
  return Object.fromEntries(headers);
}

function valueAtPath(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const part of path) {
    if (
      !current ||
      typeof current !== 'object' ||
      Array.isArray(current) ||
      !Object.hasOwn(current, part)
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function invalidValue(
  binding: Readonly<AxMCPParamHeaderBinding>,
  value: unknown
): AxMCPParamHeaderSchemaError {
  return new AxMCPParamHeaderSchemaError(
    `${binding.headerName} expected ${binding.type} at arguments.${binding.path.join('.')}, received ${typeof value}`
  );
}
