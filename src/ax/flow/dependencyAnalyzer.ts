/**
 * Analyzes mapping functions to extract state dependencies.
 *
 * This class is crucial for the automatic parallelization feature of AxFlow.
 * It determines which fields in the state object a mapping function accesses,
 * which allows the execution planner to understand dependencies between steps
 * and optimize execution by running independent steps in parallel.
 *
 * The analyzer uses two complementary approaches:
 * 1. Static analysis of the function source code
 * 2. Dynamic proxy-based tracking as a fallback
 *
 * This dual approach ensures robust dependency detection even for complex
 * mapping functions that might use destructuring, computed property access,
 * or other advanced JavaScript patterns.
 */
export class AxFlowDependencyAnalyzer {
  /**
   * Analyzes a mapping function to determine which state fields it depends on.
   *
   * This method is called for every execute step to understand what data
   * the step needs from the current state. This information is used to:
   * - Build the dependency graph for parallel execution
   * - Ensure steps execute in the correct order
   * - Optimize performance by identifying independent operations
   *
   * The analysis process:
   * 1. First tries static analysis by parsing the function source
   * 2. Falls back to proxy-based tracking for complex cases
   * 3. Returns a list of field names that the mapping function accesses
   *
   * @param mapping - The mapping function that transforms state to node inputs
   * @param _nodeName - The name of the node (currently unused but kept for future use)
   * @returns Array of field names that the mapping function depends on
   *
   * @example
   * ```typescript
   * // For a mapping like: state => ({ query: state.userInput, context: state.previousResult })
   * // This would return: ['userInput', 'previousResult']
   * ```
   */
  analyzeMappingDependencies(
    mapping: (state: any) => any,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _nodeName: string
  ): string[] {
    // Handle null/undefined mapping functions
    if (!mapping || typeof mapping !== 'function') {
      return [];
    }

    const dependencies: string[] = [];

    try {
      // Method 1: Static analysis of function source
      // This approach parses the function's source code to find property access patterns
      // It's fast and works for most common cases like state.fieldName
      const source = mapping.toString();
      const stateAccessMatches = Array.from(source.matchAll(/state\.(\w+)/g));
      for (const match of stateAccessMatches) {
        if (match[1] && !dependencies.includes(match[1])) {
          dependencies.push(match[1]);
        }
      }

      // Method 2: Proxy-based tracking (fallback for complex cases)
      // This approach actually calls the mapping function with a proxy object
      // that tracks all property access, catching cases that static analysis might miss
      // Examples: destructuring, computed properties, nested access patterns
      if (dependencies.length === 0) {
        try {
          const tracker = this.createDependencyTracker(dependencies);
          mapping(tracker);
        } catch {
          // Expected - we're just tracking access patterns, not executing the logic
          // The function may throw errors when called with our proxy, but that's OK
        }
      }
    } catch (error) {
      // If any error occurs during analysis, return empty dependencies
      console.debug('Dependency analysis failed:', error);
    }

    return dependencies;
  }

  /**
   * Creates a tracking proxy for dependency analysis.
   *
   * This is a public method that creates a proxy to track property access patterns.
   * It's used for testing and advanced dependency analysis scenarios.
   *
   * @param target - The target object to wrap with a proxy
   * @param accessed - Array to collect accessed property names
   * @returns Proxy object that tracks property access
   */
  createTrackingProxy(target: any, accessed: string[]): any {
    const self = this;
    return new Proxy(target, {
      get(obj, prop) {
        if (typeof prop === 'string' && !accessed.includes(prop)) {
          accessed.push(prop);
        }

        const value = obj[prop];

        // Return nested proxies for objects to track deeper access
        if (value && typeof value === 'object') {
          return self.createTrackingProxy(value, accessed);
        }

        return value;
      },

      has(obj, prop) {
        if (typeof prop === 'string' && !accessed.includes(prop)) {
          accessed.push(prop);
        }
        return prop in obj;
      },
    });
  }

  /**
   * Parses function source code to extract state dependencies using static analysis.
   *
   * This method analyzes the source code of a function to find patterns like
   * `state.fieldName` and extracts the field names as dependencies.
   *
   * @param functionSource - The source code of the function to analyze
   * @returns Array of field names found in the source code
   */
  parseStaticDependencies(functionSource: string): string[] {
    const dependencies: string[] = [];

    try {
      // Match state.fieldName patterns
      const stateAccessMatches = Array.from(
        functionSource.matchAll(/state\.(\w+)/g)
      );
      for (const match of stateAccessMatches) {
        if (match[1] && !dependencies.includes(match[1])) {
          dependencies.push(match[1]);
        }
      }

      // Match template literal patterns ${state.fieldName}
      const templateMatches = Array.from(
        functionSource.matchAll(/\$\{state\.(\w+)\}/g)
      );
      for (const match of templateMatches) {
        if (match[1] && !dependencies.includes(match[1])) {
          dependencies.push(match[1]);
        }
      }

      // Match destructuring patterns
      const destructureMatches = Array.from(
        functionSource.matchAll(/\{\s*(\w+)(?:\s*,\s*(\w+))*\s*\}\s*=\s*state/g)
      );
      for (const match of destructureMatches) {
        for (let i = 1; i < match.length; i++) {
          if (match[i] && !dependencies.includes(match[i])) {
            dependencies.push(match[i]);
          }
        }
      }
    } catch (error) {
      // If parsing fails, return empty array
      console.debug('Static dependency parsing failed:', error);
    }

    return dependencies;
  }

  /**
   * Creates a proxy object that tracks property access for dependency analysis.
   *
   * This proxy intercepts all property access on the state object and records
   * which fields are being accessed. It's used as a fallback when static analysis
   * can't determine dependencies (e.g., for destructuring or computed properties).
   *
   * The proxy works by:
   * 1. Intercepting all property access via the 'get' trap
   * 2. Recording accessed property names in the dependencies array
   * 3. Returning nested proxies for chained property access
   *
   * This allows detection of complex access patterns like:
   * - Destructuring: const { field1, field2 } = state
   * - Computed properties: state[dynamicKey]
   * - Nested access: state.nested.field
   *
   * @param dependencies - Array to collect dependency names (modified in place)
   * @returns Proxy object that tracks property access
   */
  private createDependencyTracker(dependencies: string[]): any {
    return new Proxy(
      {},
      {
        get(_target, prop) {
          // Record this property access if it's a string and not already recorded
          if (typeof prop === 'string' && !dependencies.includes(prop)) {
            dependencies.push(prop);
          }

          // Return another proxy for nested access patterns
          // This allows tracking of chained property access like state.nested.field
          return new Proxy(
            {},
            {
              get: () => undefined, // Always return undefined for nested access
            }
          );
        },
      }
    );
  }
}
