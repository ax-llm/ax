import type { AxFunctionJSONSchema } from '../ai/types.js';
import { AxFunctionError } from './functions.js';

/** Validate native completed arguments before invoking a host tool. */
export function axValidateToolArguments(
  schema: AxFunctionJSONSchema | undefined,
  value: unknown
): void {
  if (!schema) return;
  type Schema = Record<string, any>;
  const root = schema as Schema;
  const errors: { field: string; message: string }[] = [];
  const visit = (
    spec: Schema,
    input: unknown,
    path: string,
    depth = 0
  ): void => {
    const fail = (message: string) =>
      errors.push({ field: path || 'arguments', message });
    if (depth > 64) {
      fail('Arguments exceed schema nesting limit');
      return;
    }
    if (spec.$ref) {
      if (!String(spec.$ref).startsWith('#/')) {
        fail('External schema references are unsupported');
        return;
      }
      let target: any = root;
      for (const part of String(spec.$ref).slice(2).split('/'))
        target = target?.[part.replace(/~1/g, '/').replace(/~0/g, '~')];
      if (!target) {
        fail('Unresolved schema reference');
        return;
      }
      visit(target, input, path, depth + 1);
      return;
    }
    for (const branch of spec.allOf ?? [])
      visit(branch, input, path, depth + 1);
    for (const keyword of ['anyOf', 'oneOf'] as const) {
      if (!Array.isArray(spec[keyword])) continue;
      let matches = 0;
      for (const branch of spec[keyword]) {
        const before = errors.length;
        visit(branch, input, path, depth + 1);
        if (errors.length === before) matches++;
        errors.splice(before);
      }
      if (matches === 0 || (keyword === 'oneOf' && matches !== 1))
        fail(`Arguments do not match ${keyword}`);
    }
    const types = Array.isArray(spec.type)
      ? spec.type
      : spec.type
        ? [spec.type]
        : [];
    const actual =
      input === null ? 'null' : Array.isArray(input) ? 'array' : typeof input;
    if (
      types.length &&
      !types.some(
        (type: string) =>
          type === actual ||
          (type === 'integer' &&
            typeof input === 'number' &&
            Number.isInteger(input))
      )
    ) {
      fail(`Expected ${types.join(' or ')}, received ${actual}`);
      return;
    }
    if (
      spec.enum &&
      !spec.enum.some(
        (item: unknown) => JSON.stringify(item) === JSON.stringify(input)
      )
    )
      fail('Value is not in the allowed enum');
    if ('const' in spec && JSON.stringify(spec.const) !== JSON.stringify(input))
      fail('Value does not match const');
    if (typeof input === 'string') {
      if (spec.minLength !== undefined && [...input].length < spec.minLength)
        fail('String is too short');
      if (spec.maxLength !== undefined && [...input].length > spec.maxLength)
        fail('String is too long');
      if (spec.pattern && !new RegExp(spec.pattern).test(input))
        fail('String does not match pattern');
    }
    if (typeof input === 'number') {
      if (!Number.isFinite(input)) fail('Number must be finite');
      if (spec.minimum !== undefined && input < spec.minimum)
        fail('Number is below minimum');
      if (spec.maximum !== undefined && input > spec.maximum)
        fail('Number is above maximum');
    }
    if (Array.isArray(input)) {
      if (spec.minItems !== undefined && input.length < spec.minItems)
        fail('Too few items');
      if (spec.maxItems !== undefined && input.length > spec.maxItems)
        fail('Too many items');
      if (spec.items)
        input.forEach((item, index) =>
          visit(spec.items, item, `${path}[${index}]`, depth + 1)
        );
    } else if (input && typeof input === 'object') {
      const object = input as Record<string, unknown>;
      for (const required of spec.required ?? [])
        if (!Object.hasOwn(object, required))
          errors.push({
            field: path ? `${path}.${required}` : required,
            message: 'Required argument is missing',
          });
      for (const [key, item] of Object.entries(object)) {
        const child = spec.properties?.[key];
        if (child) visit(child, item, path ? `${path}.${key}` : key, depth + 1);
        else if (spec.additionalProperties === false)
          fail(`Unexpected property: ${key}`);
        else if (
          spec.additionalProperties &&
          typeof spec.additionalProperties === 'object'
        )
          visit(spec.additionalProperties, item, `${path}.${key}`, depth + 1);
      }
    }
  };
  visit(root, value, '');
  if (errors.length) throw new AxFunctionError(errors);
}
