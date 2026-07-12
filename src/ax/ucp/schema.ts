import type { AxMCPSSRFProtectionOptions } from '../mcp/util/ssrf.js';
import { fetchWithSSRFProtection } from '../mcp/util/ssrf.js';

export interface AxUCPSchemaValidationOptions {
  fetch?: typeof globalThis.fetch;
  ssrfProtection?: AxMCPSSRFProtectionOptions;
  maxDocuments?: number;
  maxDepth?: number;
}

type Schema = boolean | Record<string, unknown>;

export class AxUCPSchemaValidationError extends Error {
  constructor(
    readonly instancePath: string,
    readonly schemaPath: string,
    message: string
  ) {
    super(`UCP schema validation failed at ${instancePath || '/'}: ${message}`);
    this.name = 'AxUCPSchemaValidationError';
  }
}

/** Bounded, dependency-free JSON Schema 2020-12 validator for UCP schemas. */
export class AxUCPSchemaValidator {
  private readonly documents = new Map<string, Record<string, unknown>>();

  constructor(
    private readonly options: Readonly<AxUCPSchemaValidationOptions> = {}
  ) {}

  async validate(value: unknown, schemaUrl: string): Promise<void> {
    const root = await this.loadDocument(schemaUrl);
    await this.validateSchema(value, root, {
      documentUrl: schemaUrl,
      document: root,
      instancePath: '',
      schemaPath: '#',
      depth: 0,
    });
  }

  clearCache(): void {
    this.documents.clear();
  }

  private async loadDocument(url: string): Promise<Record<string, unknown>> {
    const canonical = new URL(url).toString();
    const cached = this.documents.get(canonical);
    if (cached) return cached;
    if (this.documents.size >= (this.options.maxDocuments ?? 64)) {
      throw new Error('UCP schema document limit exceeded');
    }
    const response = await fetchWithSSRFProtection(canonical, {
      headers: { Accept: 'application/schema+json, application/json' },
      fetch: this.options.fetch,
      ssrfProtection: this.options.ssrfProtection,
      ssrfContext: 'mcp-endpoint',
    });
    if (!response.ok) {
      throw new Error(
        `UCP schema fetch failed: ${response.status} ${response.statusText}`
      );
    }
    const schema = (await response.json()) as Record<string, unknown>;
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
      throw new Error(`UCP schema ${canonical} is not a JSON object`);
    }
    this.documents.set(canonical, schema);
    return schema;
  }

  private async resolveReference(
    reference: string,
    context: Readonly<{
      documentUrl: string;
      document: Record<string, unknown>;
    }>
  ): Promise<{
    schema: Schema;
    documentUrl: string;
    document: Record<string, unknown>;
    schemaPath: string;
  }> {
    const resolved = new URL(reference, context.documentUrl);
    const documentUrl = `${resolved.origin}${resolved.pathname}${resolved.search}`;
    const document =
      documentUrl === context.documentUrl
        ? context.document
        : await this.loadDocument(documentUrl);
    let schema: unknown = document;
    const pointer = resolved.hash.slice(1);
    if (pointer) {
      if (!pointer.startsWith('/')) {
        throw new Error(`Unsupported UCP schema anchor #${pointer}`);
      }
      for (const token of pointer
        .slice(1)
        .split('/')
        .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))) {
        if (!schema || typeof schema !== 'object' || !(token in schema)) {
          throw new Error(`Unresolved UCP schema reference ${reference}`);
        }
        schema = (schema as Record<string, unknown>)[token];
      }
    }
    if (
      typeof schema !== 'boolean' &&
      (!schema || typeof schema !== 'object')
    ) {
      throw new Error(`UCP schema reference ${reference} is not a schema`);
    }
    return {
      schema: schema as Schema,
      documentUrl,
      document,
      schemaPath: resolved.hash || '#',
    };
  }

  private async validateSchema(
    value: unknown,
    schema: Schema,
    context: Readonly<{
      documentUrl: string;
      document: Record<string, unknown>;
      instancePath: string;
      schemaPath: string;
      depth: number;
    }>
  ): Promise<void> {
    if (context.depth > (this.options.maxDepth ?? 128)) {
      throw new Error('UCP schema validation depth exceeded');
    }
    if (schema === true) return;
    if (schema === false) this.fail(context, 'boolean schema rejects value');
    const child = (instanceToken: string, schemaToken: string) => ({
      ...context,
      instancePath: `${context.instancePath}/${this.escape(instanceToken)}`,
      schemaPath: `${context.schemaPath}/${this.escape(schemaToken)}`,
      depth: context.depth + 1,
    });
    if (typeof schema.$ref === 'string') {
      const resolved = await this.resolveReference(schema.$ref, context);
      await this.validateSchema(value, resolved.schema, {
        ...context,
        documentUrl: resolved.documentUrl,
        document: resolved.document,
        schemaPath: resolved.schemaPath,
        depth: context.depth + 1,
      });
    }
    if (schema.const !== undefined && !this.deepEqual(value, schema.const)) {
      this.fail(context, 'value does not match const');
    }
    if (
      Array.isArray(schema.enum) &&
      !schema.enum.some((candidate) => this.deepEqual(value, candidate))
    ) {
      this.fail(context, 'value is not in enum');
    }
    if (schema.type !== undefined && !this.matchesType(value, schema.type)) {
      this.fail(context, `expected type ${JSON.stringify(schema.type)}`);
    }
    for (const keyword of ['allOf'] as const) {
      if (Array.isArray(schema[keyword])) {
        for (let index = 0; index < schema[keyword].length; index++) {
          await this.validateSchema(
            value,
            schema[keyword][index] as Schema,
            child('', `${keyword}/${index}`)
          );
        }
      }
    }
    for (const keyword of ['anyOf', 'oneOf'] as const) {
      if (Array.isArray(schema[keyword])) {
        let matches = 0;
        for (let index = 0; index < schema[keyword].length; index++) {
          try {
            await this.validateSchema(
              value,
              schema[keyword][index] as Schema,
              child('', `${keyword}/${index}`)
            );
            matches++;
          } catch (error) {
            if (!(error instanceof AxUCPSchemaValidationError)) throw error;
          }
        }
        if (matches === 0 || (keyword === 'oneOf' && matches !== 1)) {
          this.fail(context, `${keyword} matched ${matches} schemas`);
        }
      }
    }
    if (schema.not !== undefined) {
      let matched = true;
      try {
        await this.validateSchema(
          value,
          schema.not as Schema,
          child('', 'not')
        );
      } catch (error) {
        if (error instanceof AxUCPSchemaValidationError) matched = false;
        else throw error;
      }
      if (matched) this.fail(context, 'value matches forbidden not schema');
    }
    if (schema.if !== undefined) {
      let matched = true;
      try {
        await this.validateSchema(value, schema.if as Schema, child('', 'if'));
      } catch (error) {
        if (error instanceof AxUCPSchemaValidationError) matched = false;
        else throw error;
      }
      const branch = matched ? schema.then : schema.else;
      if (branch !== undefined) {
        await this.validateSchema(
          value,
          branch as Schema,
          child('', matched ? 'then' : 'else')
        );
      }
    }
    if (typeof value === 'string') this.validateString(value, schema, context);
    if (typeof value === 'number') this.validateNumber(value, schema, context);
    if (Array.isArray(value)) {
      if (typeof schema.minItems === 'number' && value.length < schema.minItems)
        this.fail(context, `requires at least ${schema.minItems} items`);
      if (typeof schema.maxItems === 'number' && value.length > schema.maxItems)
        this.fail(context, `allows at most ${schema.maxItems} items`);
      if (schema.uniqueItems === true) {
        for (let i = 0; i < value.length; i++) {
          if (value.slice(0, i).some((item) => this.deepEqual(item, value[i])))
            this.fail(context, 'array items must be unique');
        }
      }
      if (schema.items !== undefined) {
        for (let index = 0; index < value.length; index++) {
          await this.validateSchema(
            value[index],
            schema.items as Schema,
            child(String(index), 'items')
          );
        }
      }
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      await this.validateObject(
        value as Record<string, unknown>,
        schema,
        context
      );
    }
  }

  private async validateObject(
    value: Record<string, unknown>,
    schema: Record<string, unknown>,
    context: Parameters<AxUCPSchemaValidator['validateSchema']>[2]
  ): Promise<void> {
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) {
      if (typeof key === 'string' && !Object.hasOwn(value, key)) {
        this.fail(context, `missing required property ${key}`);
      }
    }
    const properties =
      schema.properties && typeof schema.properties === 'object'
        ? (schema.properties as Record<string, Schema>)
        : {};
    const patternProperties =
      schema.patternProperties && typeof schema.patternProperties === 'object'
        ? (schema.patternProperties as Record<string, Schema>)
        : {};
    for (const [key, item] of Object.entries(value)) {
      const matches = Object.entries(patternProperties).filter(([pattern]) =>
        new RegExp(pattern).test(key)
      );
      if (properties[key] !== undefined) {
        await this.validateSchema(item, properties[key]!, {
          ...context,
          instancePath: `${context.instancePath}/${this.escape(key)}`,
          schemaPath: `${context.schemaPath}/properties/${this.escape(key)}`,
          depth: context.depth + 1,
        });
      }
      for (const [pattern, itemSchema] of matches) {
        await this.validateSchema(item, itemSchema, {
          ...context,
          instancePath: `${context.instancePath}/${this.escape(key)}`,
          schemaPath: `${context.schemaPath}/patternProperties/${this.escape(pattern)}`,
          depth: context.depth + 1,
        });
      }
      if (
        properties[key] === undefined &&
        matches.length === 0 &&
        schema.additionalProperties === false
      ) {
        this.fail(context, `additional property ${key} is not allowed`);
      }
      if (
        properties[key] === undefined &&
        matches.length === 0 &&
        schema.additionalProperties &&
        typeof schema.additionalProperties === 'object'
      ) {
        await this.validateSchema(
          item,
          schema.additionalProperties as Schema,
          context
        );
      }
    }
  }

  private validateString(
    value: string,
    schema: Record<string, unknown>,
    context: Parameters<AxUCPSchemaValidator['validateSchema']>[2]
  ): void {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength)
      this.fail(context, `string is shorter than ${schema.minLength}`);
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength)
      this.fail(context, `string is longer than ${schema.maxLength}`);
    if (
      typeof schema.pattern === 'string' &&
      !new RegExp(schema.pattern).test(value)
    )
      this.fail(context, `string does not match ${schema.pattern}`);
    if (schema.format === 'uri') {
      try {
        new URL(value);
      } catch {
        this.fail(context, 'string is not a URI');
      }
    }
    if (schema.format === 'date-time' && Number.isNaN(Date.parse(value))) {
      this.fail(context, 'string is not an RFC 3339 date-time');
    }
  }

  private validateNumber(
    value: number,
    schema: Record<string, unknown>,
    context: Parameters<AxUCPSchemaValidator['validateSchema']>[2]
  ): void {
    if (typeof schema.minimum === 'number' && value < schema.minimum)
      this.fail(context, `number is below ${schema.minimum}`);
    if (typeof schema.maximum === 'number' && value > schema.maximum)
      this.fail(context, `number is above ${schema.maximum}`);
    if (
      typeof schema.exclusiveMinimum === 'number' &&
      value <= schema.exclusiveMinimum
    )
      this.fail(context, `number must exceed ${schema.exclusiveMinimum}`);
    if (
      typeof schema.exclusiveMaximum === 'number' &&
      value >= schema.exclusiveMaximum
    )
      this.fail(context, `number must be below ${schema.exclusiveMaximum}`);
  }

  private matchesType(value: unknown, expected: unknown): boolean {
    const types = Array.isArray(expected) ? expected : [expected];
    return types.some((type) => {
      if (type === 'null') return value === null;
      if (type === 'array') return Array.isArray(value);
      if (type === 'object')
        return (
          value !== null && typeof value === 'object' && !Array.isArray(value)
        );
      if (type === 'integer') return Number.isInteger(value);
      return typeof value === type;
    });
  }

  private fail(
    context: Readonly<{ instancePath: string; schemaPath: string }>,
    message: string
  ): never {
    throw new AxUCPSchemaValidationError(
      context.instancePath,
      context.schemaPath,
      message
    );
  }

  private escape(value: string): string {
    return value.replaceAll('~', '~0').replaceAll('/', '~1');
  }

  private deepEqual(left: unknown, right: unknown): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
  }
}
