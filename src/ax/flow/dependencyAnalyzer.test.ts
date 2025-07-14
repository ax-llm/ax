/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it } from 'vitest';

import { AxFlowDependencyAnalyzer } from './dependencyAnalyzer.js';

describe('AxFlowDependencyAnalyzer', () => {
  let analyzer: AxFlowDependencyAnalyzer;

  beforeEach(() => {
    analyzer = new AxFlowDependencyAnalyzer();
  });

  describe('analyzeMappingDependencies', () => {
    it('should analyze simple property access', () => {
      const mapping = (state: any) => ({ input: state.value });
      const dependencies = analyzer.analyzeMappingDependencies(
        mapping,
        'testNode'
      );

      expect(dependencies).toContain('value');
    });

    it('should analyze nested property access', () => {
      const mapping = (state: any) => ({ input: state.nested.deep.value });
      const dependencies = analyzer.analyzeMappingDependencies(
        mapping,
        'testNode'
      );

      expect(dependencies).toContain('nested');
    });

    it('should analyze multiple property access', () => {
      const mapping = (state: any) => ({
        field1: state.prop1,
        field2: state.prop2,
        field3: state.prop3,
      });
      const dependencies = analyzer.analyzeMappingDependencies(
        mapping,
        'testNode'
      );

      expect(dependencies).toContain('prop1');
      expect(dependencies).toContain('prop2');
      expect(dependencies).toContain('prop3');
    });

    it('should handle destructuring assignments', () => {
      const mapping = (state: any) => {
        const { field1, field2 } = state.data;
        return { field1, field2 };
      };
      const dependencies = analyzer.analyzeMappingDependencies(
        mapping,
        'testNode'
      );

      expect(dependencies).toContain('data');
    });

    it('should handle computed property access', () => {
      const mapping = (state: any) => ({
        computed: state.a + state.b,
        result: state.values[0],
      });
      const dependencies = analyzer.analyzeMappingDependencies(
        mapping,
        'testNode'
      );

      expect(dependencies).toContain('a');
      expect(dependencies).toContain('b');
      expect(dependencies).toContain('values');
    });

    it('should handle array access patterns', () => {
      const mapping = (state: any) => ({
        first: state.items[0],
        length: state.items.length,
      });
      const dependencies = analyzer.analyzeMappingDependencies(
        mapping,
        'testNode'
      );

      expect(dependencies).toContain('items');
    });

    it('should handle method calls on state properties', () => {
      const mapping = (state: any) => ({
        uppercase: state.text.toUpperCase(),
        sliced: state.text.slice(0, 10),
      });
      const dependencies = analyzer.analyzeMappingDependencies(
        mapping,
        'testNode'
      );

      expect(dependencies).toContain('text');
    });

    it('should handle conditional access', () => {
      const mapping = (state: any) => ({
        safe: state.optional?.value || 'default',
        conditional: state.condition ? state.truthy : state.falsy,
      });
      const dependencies = analyzer.analyzeMappingDependencies(
        mapping,
        'testNode'
      );

      expect(dependencies).toContain('optional');
      expect(dependencies).toContain('condition');
      expect(dependencies).toContain('truthy');
      expect(dependencies).toContain('falsy');
    });

    it('should handle spread operator usage', () => {
      const mapping = (state: any) => ({
        ...state.base,
        additional: state.extra,
      });
      const dependencies = analyzer.analyzeMappingDependencies(
        mapping,
        'testNode'
      );

      expect(dependencies).toContain('base');
      expect(dependencies).toContain('extra');
    });

    it('should handle complex expressions', () => {
      const mapping = (state: any) => ({
        complex: state.items
          .filter((item: any) => item.active)
          .map((item: any) => item.name)
          .join(', '),
      });
      const dependencies = analyzer.analyzeMappingDependencies(
        mapping,
        'testNode'
      );

      expect(dependencies).toContain('items');
    });

    it('should handle result field references', () => {
      const mapping = (state: any) => ({
        input: state.previousNodeResult?.output || state.fallback,
      });
      const dependencies = analyzer.analyzeMappingDependencies(
        mapping,
        'testNode'
      );

      expect(dependencies).toContain('previousNodeResult');
      expect(dependencies).toContain('fallback');
    });

    it('should ignore local variables and constants', () => {
      const mapping = (state: any) => {
        const localVar = 'constant';
        const computed = `${localVar}suffix`;
        return {
          value: state.actualDep,
          local: computed,
        };
      };
      const dependencies = analyzer.analyzeMappingDependencies(
        mapping,
        'testNode'
      );

      expect(dependencies).toContain('actualDep');
      expect(dependencies).not.toContain('localVar');
      expect(dependencies).not.toContain('computed');
    });

    it('should handle empty mappings', () => {
      const mapping = () => ({});
      const dependencies = analyzer.analyzeMappingDependencies(
        mapping,
        'testNode'
      );

      expect(dependencies).toEqual([]);
    });

    it('should handle mappings with only literal values', () => {
      const mapping = () => ({
        static: 'value',
        number: 42,
        boolean: true,
      });
      const dependencies = analyzer.analyzeMappingDependencies(
        mapping,
        'testNode'
      );

      expect(dependencies).toEqual([]);
    });

    it('should handle function parameters correctly', () => {
      const mapping = (state: any, context: any) => ({
        fromState: state.value,
        fromContext: context.config,
      });
      const dependencies = analyzer.analyzeMappingDependencies(
        mapping,
        'testNode'
      );

      expect(dependencies).toContain('value');
      expect(dependencies).not.toContain('config'); // context is not part of state
    });
  });

  describe('proxy-based dependency tracking', () => {
    it('should track property access through proxy', () => {
      const accessed: string[] = [];
      const proxy = analyzer.createTrackingProxy(
        {
          field1: 'value1',
          field2: 'value2',
        },
        accessed
      );

      // Access properties
      proxy.field1;
      proxy.field2;

      expect(accessed).toContain('field1');
      expect(accessed).toContain('field2');
    });

    it('should track nested property access', () => {
      const accessed: string[] = [];
      const proxy = analyzer.createTrackingProxy(
        {
          nested: {
            deep: {
              value: 'test',
            },
          },
        },
        accessed
      );

      proxy.nested.deep.value;

      expect(accessed).toContain('nested');
    });

    it('should track array access', () => {
      const accessed: string[] = [];
      const proxy = analyzer.createTrackingProxy(
        {
          items: [1, 2, 3],
        },
        accessed
      );

      proxy.items[0];
      proxy.items.length;

      expect(accessed).toContain('items');
    });

    it('should handle method calls on tracked properties', () => {
      const accessed: string[] = [];
      const proxy = analyzer.createTrackingProxy(
        {
          text: 'hello world',
        },
        accessed
      );

      proxy.text.toUpperCase();

      expect(accessed).toContain('text');
    });

    it('should handle optional chaining', () => {
      const accessed: string[] = [];
      const proxy = analyzer.createTrackingProxy(
        {
          optional: null,
        },
        accessed
      );

      proxy.optional?.value;

      expect(accessed).toContain('optional');
    });

    it('should handle property existence checks', () => {
      const accessed: string[] = [];
      const proxy = analyzer.createTrackingProxy(
        {
          field: 'value',
        },
        accessed
      );

      'field' in proxy;
      Object.hasOwn(proxy, 'field');

      expect(accessed).toContain('field');
    });

    it('should handle undefined properties gracefully', () => {
      const accessed: string[] = [];
      const proxy = analyzer.createTrackingProxy(
        {
          existing: 'value',
        },
        accessed
      );

      proxy.nonExisting;

      expect(accessed).toContain('nonExisting');
    });

    it('should track destructuring patterns', () => {
      const accessed: string[] = [];
      const proxy = analyzer.createTrackingProxy(
        {
          data: { a: 1, b: 2 },
          items: [1, 2, 3],
        },
        accessed
      );

      const { data } = proxy;
      const [_first] = proxy.items;
      void data; // Use data to avoid unused variable warning

      expect(accessed).toContain('data');
      expect(accessed).toContain('items');
    });
  });

  describe('static code analysis', () => {
    it('should parse function source code for dependencies', () => {
      const functionSource = `
        function(state) {
          return {
            value: state.input,
            computed: state.data.value + state.other
          };
        }
      `;

      const dependencies = analyzer.parseStaticDependencies(functionSource);

      expect(dependencies).toContain('input');
      expect(dependencies).toContain('data');
      expect(dependencies).toContain('other');
    });

    it('should handle arrow functions', () => {
      const functionSource = '(state) => ({ result: state.value })';

      const dependencies = analyzer.parseStaticDependencies(functionSource);

      expect(dependencies).toContain('value');
    });

    it('should handle complex property paths', () => {
      const functionSource = `
        function(state) {
          return {
            nested: state.level1.level2.value,
            array: state.items[0].name
          };
        }
      `;

      const dependencies = analyzer.parseStaticDependencies(functionSource);

      expect(dependencies).toContain('level1');
      expect(dependencies).toContain('items');
    });

    it('should ignore non-state references', () => {
      const functionSource = `
        function(state) {
          const localVar = 'test';
          return {
            value: state.actual,
            local: localVar,
            math: Math.max(1, 2)
          };
        }
      `;

      const dependencies = analyzer.parseStaticDependencies(functionSource);

      expect(dependencies).toContain('actual');
      expect(dependencies).not.toContain('localVar');
      expect(dependencies).not.toContain('Math');
    });

    it('should handle template literals', () => {
      const functionSource = `
        function(state) {
          return {
            template: \`Hello \${state.name}, your score is \${state.score}\`
          };
        }
      `;

      const dependencies = analyzer.parseStaticDependencies(functionSource);

      expect(dependencies).toContain('name');
      expect(dependencies).toContain('score');
    });

    it('should handle conditional expressions', () => {
      const functionSource = `
        function(state) {
          return {
            conditional: state.condition ? state.truthy : state.falsy
          };
        }
      `;

      const dependencies = analyzer.parseStaticDependencies(functionSource);

      expect(dependencies).toContain('condition');
      expect(dependencies).toContain('truthy');
      expect(dependencies).toContain('falsy');
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle null/undefined mapping functions', () => {
      expect(() => {
        analyzer.analyzeMappingDependencies(null as any, 'testNode');
      }).not.toThrow();

      expect(() => {
        analyzer.analyzeMappingDependencies(undefined as any, 'testNode');
      }).not.toThrow();
    });

    it('should handle functions that throw errors', () => {
      const throwingMapping = () => {
        throw new Error('Test error');
      };

      expect(() => {
        analyzer.analyzeMappingDependencies(throwingMapping, 'testNode');
      }).not.toThrow();
    });

    it('should handle circular references in state', () => {
      const circularState: any = { value: 'test' };
      circularState.self = circularState;

      const mapping = (state: any) => ({ result: state.value });

      expect(() => {
        analyzer.analyzeMappingDependencies(mapping, 'testNode');
      }).not.toThrow();
    });

    it('should handle very deep property access', () => {
      const mapping = (state: any) => ({
        deep: state.a.b.c.d.e.f.g.h.i.j.value,
      });

      expect(() => {
        analyzer.analyzeMappingDependencies(mapping, 'testNode');
      }).not.toThrow();
    });

    it('should handle malformed function source', () => {
      const malformedSource = 'not a valid function';

      expect(() => {
        analyzer.parseStaticDependencies(malformedSource);
      }).not.toThrow();
    });
  });
});
