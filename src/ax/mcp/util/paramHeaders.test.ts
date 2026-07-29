import { describe, expect, it } from 'vitest';
import {
  AxMCPParamHeaderSchemaError,
  axMCPBuildParamHeaders,
  axMCPParamHeaderBindings,
} from './paramHeaders.js';

describe('MCP x-mcp-header parameters', () => {
  it('extracts nested string, integer, and boolean properties', () => {
    const schema = {
      type: 'object',
      properties: {
        region: { type: 'string', 'x-mcp-header': 'Region' },
        routing: {
          type: 'object',
          properties: {
            shard: { type: 'integer', 'x-mcp-header': 'Shard' },
            urgent: { type: 'boolean', 'x-mcp-header': 'Urgent' },
          },
        },
      },
    };

    expect(axMCPParamHeaderBindings(schema)).toEqual([
      { headerName: 'Mcp-Param-Region', path: ['region'], type: 'string' },
      {
        headerName: 'Mcp-Param-Shard',
        path: ['routing', 'shard'],
        type: 'integer',
      },
      {
        headerName: 'Mcp-Param-Urgent',
        path: ['routing', 'urgent'],
        type: 'boolean',
      },
    ]);
    expect(
      axMCPBuildParamHeaders(schema, {
        region: 'us-west1',
        routing: { shard: -7, urgent: false },
      })
    ).toEqual({
      'Mcp-Param-Region': 'us-west1',
      'Mcp-Param-Shard': '-7',
      'Mcp-Param-Urgent': 'false',
    });
  });

  it('omits absent and null values and sentinel-encodes unsafe strings', () => {
    const schema = {
      type: 'object',
      properties: {
        absent: { type: 'string', 'x-mcp-header': 'Absent' },
        nullable: { type: 'string', 'x-mcp-header': 'Nullable' },
        greeting: { type: 'string', 'x-mcp-header': 'Greeting' },
        literal: { type: 'string', 'x-mcp-header': 'Literal' },
      },
    };

    expect(
      axMCPBuildParamHeaders(schema, {
        nullable: null,
        greeting: 'Hello, 世界',
        literal: '=?base64?literal?=',
      })
    ).toEqual({
      'Mcp-Param-Greeting': '=?base64?SGVsbG8sIOS4lueVjA==?=',
      'Mcp-Param-Literal': '=?base64?PT9iYXNlNjQ/bGl0ZXJhbD89?=',
    });
  });

  it.each([
    [{ type: 'string', 'x-mcp-header': '' }, 'non-empty string'],
    [{ type: 'string', 'x-mcp-header': 'bad name' }, 'RFC 9110'],
    [{ type: 'string', 'x-mcp-header': 'bad\rname' }, 'RFC 9110'],
    [{ type: 'number', 'x-mcp-header': 'Amount' }, 'requires type'],
    [{ type: ['string', 'null'], 'x-mcp-header': 'Maybe' }, 'requires type'],
    [{ type: 'string', 'x-mcp-header': 4 }, 'non-empty string'],
  ])('rejects an invalid reachable annotation %#', (property, message) => {
    expect(() =>
      axMCPParamHeaderBindings({
        type: 'object',
        properties: { value: property },
      })
    ).toThrow(message as string);
  });

  it('rejects case-insensitive duplicate names', () => {
    expect(() =>
      axMCPParamHeaderBindings({
        type: 'object',
        properties: {
          first: { type: 'string', 'x-mcp-header': 'Region' },
          second: { type: 'string', 'x-mcp-header': 'region' },
        },
      })
    ).toThrow('not case-insensitively unique');
  });

  it.each(['items', 'allOf', '$defs'])(
    'rejects annotations reached through %s',
    (keyword) => {
      const annotated = {
        type: 'object',
        properties: {
          value: { type: 'string', 'x-mcp-header': 'Route' },
        },
      };
      const schema =
        keyword === 'allOf'
          ? { type: 'object', allOf: [annotated] }
          : { type: 'object', [keyword]: annotated };
      expect(() => axMCPParamHeaderBindings(schema)).toThrow(
        'not statically reachable through properties'
      );
    }
  );

  it('rejects invalid runtime types and unsafe integers', () => {
    const schema = {
      type: 'object',
      properties: {
        shard: { type: 'integer', 'x-mcp-header': 'Shard' },
      },
    };
    expect(() =>
      axMCPBuildParamHeaders(schema, { shard: Number.MAX_SAFE_INTEGER + 1 })
    ).toThrow(AxMCPParamHeaderSchemaError);
    expect(() => axMCPBuildParamHeaders(schema, { shard: '7' })).toThrow(
      'expected integer'
    );
  });
});
