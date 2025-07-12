/**
 * Analyzes mapping functions to extract state dependencies
 */
export class AxFlowDependencyAnalyzer {
  /**
   * Analyzes a mapping function to determine which state fields it depends on
   */
  analyzeMappingDependencies(
    mapping: (state: any) => any,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _nodeName: string
  ): string[] {
    const dependencies: string[] = [];

    // Method 1: Static analysis of function source
    const source = mapping.toString();
    const stateAccessMatches = Array.from(source.matchAll(/state\.(\w+)/g));
    for (const match of stateAccessMatches) {
      if (match[1] && !dependencies.includes(match[1])) {
        dependencies.push(match[1]);
      }
    }

    // Method 2: Proxy-based tracking (fallback for complex cases)
    if (dependencies.length === 0) {
      try {
        const tracker = this.createDependencyTracker(dependencies);
        mapping(tracker);
      } catch {
        // Expected - we're just tracking access patterns
      }
    }

    return dependencies;
  }

  private createDependencyTracker(dependencies: string[]): any {
    return new Proxy(
      {},
      {
        get(_target, prop) {
          if (typeof prop === 'string' && !dependencies.includes(prop)) {
            dependencies.push(prop);
          }
          // Return another proxy for nested access
          return new Proxy(
            {},
            {
              get: () => undefined,
            }
          );
        },
      }
    );
  }
}
