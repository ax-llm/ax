import { describe, expect, it } from 'vitest';

import { renderTemplateContent } from './templateEngine.js';

describe('templateEngine', () => {
  it('interpolates variables', () => {
    const rendered = renderTemplateContent('hello {{ name }}', {
      name: 'world',
    });

    expect(rendered).toBe('hello world');
  });

  it('throws on missing variables', () => {
    expect(() =>
      renderTemplateContent('hello {{ name }}', {
        notName: 'value',
      })
    ).toThrow("Missing template variable 'name'");
  });

  it('renders if/else true branch', () => {
    const rendered = renderTemplateContent(
      '{{ if enabled }}on{{ else }}off{{ /if }}',
      {
        enabled: true,
      }
    );

    expect(rendered).toBe('on');
  });

  it('renders if/else false branch', () => {
    const rendered = renderTemplateContent(
      '{{ if enabled }}on{{ else }}off{{ /if }}',
      {
        enabled: false,
      }
    );

    expect(rendered).toBe('off');
  });

  it('throws when if condition is not boolean', () => {
    expect(() =>
      renderTemplateContent('{{ if enabled }}on{{ /if }}', {
        enabled: 'yes',
      })
    ).toThrow("Condition 'enabled' must be boolean");
  });
});
