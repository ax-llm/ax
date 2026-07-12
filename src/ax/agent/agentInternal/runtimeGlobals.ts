import type {
  AxAgentCompletionProtocol,
  AxAIService,
  AxFunction,
  AxFunctionJSONSchema,
} from '../../ai/types.js';
import { AxAgentProtocolCompletionSignal } from '../completion.js';
import { serializeForEval } from '../optimize.js';
import { DISCOVERY_DISCOVER_NAME, MEMORIES_LOAD_NAME } from '../runtime.js';
import {
  type DiscoveryCallableMeta,
  normalizeAndSortDiscoveryFunctionIdentifiers,
  normalizeDiscoveryStringInput,
  renderDiscoveryFunctionDefinitionsMarkdown,
  renderDiscoveryModuleListMarkdown,
  resolveDiscoveryCallableNamespaces,
  sortDiscoveryModules,
} from '../runtimeDiscovery.js';
import { normalizeMemoriesInput } from './memoriesHelpers.js';
import type { AxAgentMemoryResult } from './memoriesTypes.js';
import type { AxAgentSkillResult } from './skillsTypes.js';
import type {
  AxAgentFunction,
  AxAgentFunctionCallRecorder,
  AxAgentFunctionModuleMeta,
  AxAgentOnFunctionCall,
} from './types.js';

type NormalizedDiscoverRequest = {
  tools: string[];
  skills: string[];
};

function normalizeOptionalStringInput(
  value: unknown,
  fieldName: string,
  functionName: string
): string[] {
  if (value === undefined) {
    return [];
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error(
        `[POLICY] ${functionName}(...) ${fieldName} entries must be non-empty strings.`
      );
    }
    return [trimmed];
  }
  if (!Array.isArray(value)) {
    throw new Error(
      `[POLICY] ${functionName}(...) ${fieldName} must be a string or string[].`
    );
  }
  if (value.length === 0) {
    throw new Error(
      `[POLICY] ${functionName}(...) ${fieldName} requires at least one entry.`
    );
  }
  const normalized = value.map((item) => {
    if (typeof item !== 'string') {
      throw new Error(
        `[POLICY] ${functionName}(...) ${fieldName} entries must be strings.`
      );
    }
    const trimmed = item.trim();
    if (!trimmed) {
      throw new Error(
        `[POLICY] ${functionName}(...) ${fieldName} entries must be non-empty strings.`
      );
    }
    return trimmed;
  });
  return [...new Set(normalized)];
}

function normalizeDiscoverInput(
  input: unknown,
  options: Readonly<{ toolsEnabled: boolean; skillsEnabled: boolean }>
): NormalizedDiscoverRequest {
  if (typeof input === 'string' || Array.isArray(input)) {
    if (!options.toolsEnabled) {
      throw new Error(
        '[POLICY] discover(string|string[]) requires function discovery to be enabled. Use discover({ skills: ... }) for skills.'
      );
    }
    return {
      tools: normalizeDiscoveryStringInput(input, 'items'),
      skills: [],
    };
  }

  if (!input || typeof input !== 'object') {
    throw new Error(
      '[POLICY] discover(...) expects a string, string[], or { tools?, skills? }.'
    );
  }

  const record = input as Record<string, unknown>;
  const hasTools = record.tools !== undefined;
  const hasSkills = record.skills !== undefined;
  if (!hasTools && !hasSkills) {
    throw new Error(
      '[POLICY] discover(...) requires at least one of tools or skills.'
    );
  }
  if (hasTools && !options.toolsEnabled) {
    throw new Error(
      '[POLICY] discover({ tools }) requires function discovery to be enabled.'
    );
  }
  if (hasSkills && !options.skillsEnabled) {
    throw new Error(
      '[POLICY] discover({ skills }) requires onSkillsSearch to be configured.'
    );
  }

  return {
    tools: hasTools
      ? normalizeOptionalStringInput(record.tools, 'tools', 'discover')
      : [],
    skills: hasSkills
      ? normalizeOptionalStringInput(record.skills, 'skills', 'discover')
      : [],
  };
}

export function wrapFunction(
  fn: AxFunction | AxAgentFunction,
  abortSignal?: AbortSignal,
  ai?: AxAIService,
  protocolForTrigger?: (triggeredBy?: string) => AxAgentCompletionProtocol,
  qualifiedName?: string,
  functionCallRecorder?: AxAgentFunctionCallRecorder,
  kind: 'internal' | 'external' = 'external',
  onFunctionCall?: AxAgentOnFunctionCall
): (...args: unknown[]) => Promise<unknown> {
  return async (...args: unknown[]) => {
    let callArgs: Record<string, unknown>;

    if (
      args.length === 1 &&
      typeof args[0] === 'object' &&
      args[0] !== null &&
      !Array.isArray(args[0])
    ) {
      callArgs = args[0] as Record<string, unknown>;
    } else {
      const paramNames = fn.parameters?.properties
        ? Object.keys(fn.parameters.properties)
        : [];
      callArgs = {};
      paramNames.forEach((name, i) => {
        if (i < args.length) {
          callArgs[name] = args[i];
        }
      });
    }

    const normalizedQualifiedName = qualifiedName ?? fn.name;
    const protocol = protocolForTrigger?.(normalizedQualifiedName);
    if (onFunctionCall) {
      try {
        await onFunctionCall({
          name: fn.name,
          qualifiedName: normalizedQualifiedName,
          args: callArgs,
          kind,
        });
      } catch {}
    }
    try {
      const result = await fn.func(callArgs, { abortSignal, ai, protocol });
      functionCallRecorder?.({
        qualifiedName: normalizedQualifiedName,
        name: fn.name,
        arguments: serializeForEval(callArgs),
        result: serializeForEval(result),
      });
      return result;
    } catch (err) {
      if (err instanceof AxAgentProtocolCompletionSignal) {
        functionCallRecorder?.({
          qualifiedName: normalizedQualifiedName,
          name: fn.name,
          arguments: serializeForEval(callArgs),
        });
        throw err;
      }
      functionCallRecorder?.({
        qualifiedName: normalizedQualifiedName,
        name: fn.name,
        arguments: serializeForEval(callArgs),
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  };
}

/**
 * Wraps agent functions under namespaced globals and child agents under
 * a configurable `<module>.*` namespace for the runtime session.
 */
export function buildRuntimeGlobals(
  self: any,
  abortSignal?: AbortSignal,
  ai?: AxAIService,
  protocolForTrigger?: (triggeredBy?: string) => AxAgentCompletionProtocol,
  functionCallRecorder?: AxAgentFunctionCallRecorder,
  onDiscoveredNamespaces?: (namespaces: readonly string[]) => void,
  onDiscoveredModules?: (
    modules: readonly string[],
    docs: Readonly<Record<string, string>>
  ) => void,
  onDiscoveredFunctions?: (
    qualifiedNames: readonly string[],
    docs: Readonly<Record<string, string>>
  ) => void,
  onLoadedSkills?: (results: readonly AxAgentSkillResult[]) => void,
  onLoadedMemories?: (results: readonly AxAgentMemoryResult[]) => void,
  onUsed?: (id: unknown, reason?: unknown) => void,
  onFunctionCall?: AxAgentOnFunctionCall,
  /**
   * Returns the snapshot of memories already loaded for the current run.
   * Forwarded to `onMemoriesSearch` so the callback can skip re-fetching
   * entries the actor already has in scope.
   */
  getCurrentMemories?: () => readonly AxAgentMemoryResult[]
): Record<string, unknown> {
  const fireInternal = async (
    name: string,
    args: Record<string, unknown>
  ): Promise<void> => {
    if (!onFunctionCall) return;
    try {
      await onFunctionCall({
        name,
        qualifiedName: name,
        args,
        kind: 'internal',
      });
    } catch {}
  };
  const s = self as any;
  const globals: Record<string, unknown> = {};
  const callableLookup = new Map<string, DiscoveryCallableMeta>();
  const moduleLookup = new Map<string, string[]>();
  const moduleMetaLookup = new Map<string, AxAgentFunctionModuleMeta>();
  for (const [namespace, meta] of s.agentFunctionModuleMetadata) {
    moduleMetaLookup.set(namespace, meta);
  }
  const registerCallable = (
    meta: DiscoveryCallableMeta,
    qualifiedName: string
  ) => {
    callableLookup.set(qualifiedName, meta);
    if (!moduleLookup.has(meta.module)) {
      moduleLookup.set(meta.module, []);
    }
    moduleLookup.get(meta.module)?.push(qualifiedName);
  };

  // Stages that don't execute tools (the distiller) see the full tool
  // surface (catalogs, discovery docs, schemas — the extraction guide) but
  // their callables are throwing stubs whose error text redirects the actor
  // to extract inputs and forward them via final(request, evidence).
  const executesTools = s.stagePolicy?.executesTools !== false;
  const buildStageToolStub =
    (qualifiedName: string) =>
    async (..._args: unknown[]): Promise<never> => {
      throw new Error(
        `[POLICY] ${qualifiedName}(...) executes in the executor stage — this context stage cannot run tools. ` +
          'Extract the exact inputs it will need (ids, paths, records) and forward them in final(request, evidence).'
      );
    };

  // Agent functions under namespace.* (e.g. utils.myFn, custom.otherFn).
  // Agent-derived entries carry `_kind: 'internal'` so that `onFunctionCall`
  // observers can still distinguish them from user-registered tools; everything
  // else lands under the same flow.
  for (const agentFn of s.agentFunctions) {
    const ns = agentFn.namespace ?? 'utils';
    if (!globals[ns] || typeof globals[ns] !== 'object') {
      globals[ns] = {};
    }
    const qualifiedName = `${ns}.${agentFn.name}`;
    (globals[ns] as Record<string, unknown>)[agentFn.name] = executesTools
      ? wrapFunction(
          agentFn,
          abortSignal,
          ai,
          protocolForTrigger,
          qualifiedName,
          functionCallRecorder,
          agentFn._kind ?? 'external',
          onFunctionCall
        )
      : buildStageToolStub(qualifiedName);
    if (agentFn._alwaysInclude !== true) {
      registerCallable(
        {
          module: ns,
          name: agentFn.name,
          description: agentFn.description,
          parameters: agentFn.parameters,
          returns: agentFn.returns,
          examples: agentFn.examples,
        },
        qualifiedName
      );
    }
  }

  const mcpExecutionContext = s._activeMCPExecutionContext as
    | import('../../mcp/execution.js').AxMCPExecutionContext
    | undefined;
  if (mcpExecutionContext) {
    const mcpRoot: Record<string, unknown> = {};
    globals.mcp = mcpRoot;
    for (const client of mcpExecutionContext.clients) {
      const namespace = client.getNamespace();
      const tools: Record<string, unknown> = {};
      for (const binding of mcpExecutionContext
        .getToolBindings()
        .filter((candidate) => candidate.namespace === namespace)) {
        const qualifiedName = `mcp.${namespace}.tools.${binding.name}`;
        tools[binding.name] = executesTools
          ? wrapFunction(
              binding,
              abortSignal,
              ai,
              protocolForTrigger,
              qualifiedName,
              functionCallRecorder,
              'external',
              onFunctionCall
            )
          : buildStageToolStub(qualifiedName);
        registerCallable(
          {
            module: `mcp.${namespace}`,
            name: binding.name,
            description: binding.description,
            parameters: binding.parameters,
            returns: binding.returns,
          },
          qualifiedName
        );
      }
      const executeOrStub = <T extends (...args: any[]) => Promise<unknown>>(
        qualifiedName: string,
        fn: T
      ): T | ReturnType<typeof buildStageToolStub> =>
        executesTools ? fn : buildStageToolStub(qualifiedName);
      mcpRoot[namespace] = {
        tools,
        prompts: {
          list: () => client.getPrompts(),
          get: executeOrStub(
            `mcp.${namespace}.prompts.get`,
            (name: string, args?: Record<string, string>) =>
              client.getPrompt(name, args)
          ),
        },
        resources: {
          list: () => client.getResources(),
          templates: () => client.getResourceTemplates(),
          read: executeOrStub(
            `mcp.${namespace}.resources.read`,
            (uri: string) => client.readResource(uri)
          ),
          subscribe: executeOrStub(
            `mcp.${namespace}.resources.subscribe`,
            (uri: string) => client.subscribeResource(uri)
          ),
          unsubscribe: executeOrStub(
            `mcp.${namespace}.resources.unsubscribe`,
            (uri: string) => client.unsubscribeResource(uri)
          ),
        },
        tasks: {
          list: executeOrStub(
            `mcp.${namespace}.tasks.list`,
            (cursor?: string) => client.listTasks(cursor)
          ),
          get: executeOrStub(`mcp.${namespace}.tasks.get`, (taskId: string) =>
            client.getTask(taskId)
          ),
          result: executeOrStub(
            `mcp.${namespace}.tasks.result`,
            (taskId: string) => client.getTaskResult(taskId)
          ),
          cancel: executeOrStub(
            `mcp.${namespace}.tasks.cancel`,
            (taskId: string) => client.cancelTask(taskId)
          ),
        },
        complete: executeOrStub(
          `mcp.${namespace}.complete`,
          (...args: Parameters<typeof client.complete>) =>
            client.complete(...args)
        ),
      };
    }

    const ucpRoot: Record<string, unknown> = {};
    globals.ucp = ucpRoot;
    for (const client of mcpExecutionContext.ucpClients) {
      const namespace = client.getNamespace();
      const operations: Record<string, unknown> = {};
      for (const binding of client.getOperationBindings()) {
        const qualifiedName = `ucp.${namespace}.${binding.name}`;
        operations[binding.name] = executesTools
          ? wrapFunction(
              binding,
              abortSignal,
              ai,
              protocolForTrigger,
              qualifiedName,
              functionCallRecorder,
              'external',
              onFunctionCall
            )
          : buildStageToolStub(qualifiedName);
        registerCallable(
          {
            module: `ucp.${namespace}`,
            name: binding.name,
            description: binding.description,
            parameters: binding.parameters,
            returns: binding.returns,
          },
          qualifiedName
        );
      }
      ucpRoot[namespace] = {
        ...operations,
        profile: () => client.getProfile(),
        operations: () => client.getOperationNames(),
      };
    }
  }

  if (s.functionDiscoveryEnabled || typeof s.onSkillsSearch === 'function') {
    globals[DISCOVERY_DISCOVER_NAME] = async (
      input: unknown
    ): Promise<void> => {
      await fireInternal(DISCOVERY_DISCOVER_NAME, { request: input });
      const { tools, skills } = normalizeDiscoverInput(input, {
        toolsEnabled: Boolean(s.functionDiscoveryEnabled),
        skillsEnabled: typeof s.onSkillsSearch === 'function',
      });

      if (tools.length > 0) {
        const modules = sortDiscoveryModules(
          tools.filter((item) => {
            const meta = moduleMetaLookup.get(item);
            return moduleLookup.has(item) || meta?.alwaysInclude === true;
          })
        );
        const functionItems = tools.filter((item) => !modules.includes(item));

        if (modules.length > 0) {
          const docs = Object.fromEntries(
            modules.map((module) => [
              module,
              renderDiscoveryModuleListMarkdown(
                [module],
                moduleLookup,
                moduleMetaLookup
              ),
            ])
          );
          onDiscoveredModules?.(modules, docs);
        }

        if (functionItems.length > 0) {
          const items =
            normalizeAndSortDiscoveryFunctionIdentifiers(functionItems);
          const matchedNamespaces = resolveDiscoveryCallableNamespaces(
            items,
            callableLookup
          );
          if (matchedNamespaces.length > 0) {
            onDiscoveredNamespaces?.(matchedNamespaces);
          }
          const docs = Object.fromEntries(
            items.map((qualifiedName) => [
              qualifiedName,
              renderDiscoveryFunctionDefinitionsMarkdown(
                [qualifiedName],
                callableLookup
              ),
            ])
          );
          onDiscoveredFunctions?.(items, docs);
        }
      }

      if (skills.length > 0) {
        const results = await s.onSkillsSearch(skills);
        if (!Array.isArray(results) || results.length === 0) return;
        const matched = results as readonly AxAgentSkillResult[];
        onLoadedSkills?.(matched);
      }
    };
  }

  if (typeof s.onMemoriesSearch === 'function') {
    globals[MEMORIES_LOAD_NAME] = async (input: unknown): Promise<void> => {
      await fireInternal(MEMORIES_LOAD_NAME, { searches: input });
      const searches = normalizeMemoriesInput(input);
      if (searches.length === 0) return;
      const alreadyLoaded = getCurrentMemories?.() ?? [];
      const results = await s.onMemoriesSearch(searches, alreadyLoaded);
      if (!Array.isArray(results) || results.length === 0) return;
      const matched = results as readonly AxAgentMemoryResult[];
      onLoadedMemories?.(matched);
    };
  }

  if (s.usageTrackingEnabled === true) {
    globals.used = async (id: unknown, reason?: unknown): Promise<void> => {
      await fireInternal('used', { id, reason });
      onUsed?.(id, reason);
    };
  }

  return globals;
}

export function buildFuncParameters(self: any): AxFunctionJSONSchema {
  const s = self as any;
  return s.program.getSignature().toInputJSONSchema();
}
