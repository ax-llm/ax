import type {
  AxAgentCompletionProtocol,
  AxAIService,
  AxFunction,
  AxFunctionJSONSchema,
} from '../../ai/types.js';
import { AxAIServiceAbortedError } from '../../util/apicall.js';
import { AxAgentProtocolCompletionSignal } from '../completion.js';
import { DEFAULT_RLM_BATCH_CONCURRENCY } from '../config.js';
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
import type { TurnObservations } from './turnObservations.js';
import {
  AxAgentClarificationError,
  type AxAgentFunction,
  type AxAgentFunctionCallRecorder,
  type AxAgentFunctionModuleMeta,
  type AxAgentOnFunctionCall,
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
  onFunctionCall?: AxAgentOnFunctionCall,
  eventContext?: import('../../event/types.js').AxEventContext,
  runOptions?: Pick<
    import('../../ai/types.js').AxAIServiceOptions,
    'control' | 'executionPath'
  > & {
    _mcpExecutionContext?: import('../../mcp/execution.js').AxMCPExecutionContext;
  },
  observations?: TurnObservations,
  beforeCall?: () => void,
  // Only host-owned batch dispatch can supply this authorization. Actor code
  // cannot turn off the observation gate by passing extra tool arguments.
  authorizeCall?: () => void,
  observationName?: string
): (...args: unknown[]) => Promise<unknown> {
  return async (...args: unknown[]) => {
    const generation = observations?.captureGeneration();
    abortSignal?.throwIfAborted();
    if (authorizeCall) authorizeCall();
    else observations?.assertCanAct(undefined, qualifiedName ?? fn.name);
    beforeCall?.();
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
    const resultName = observationName ?? normalizedQualifiedName;
    const rawProtocol = protocolForTrigger?.(normalizedQualifiedName);
    const authorized =
      <TArgs extends unknown[], TResult>(
        callback: (...args: TArgs) => TResult
      ) =>
      (...args: TArgs): TResult => {
        authorizeCall?.();
        return callback(...args);
      };
    const protocol =
      rawProtocol && authorizeCall
        ? {
            ...rawProtocol,
            final: authorized(rawProtocol.final),
            askClarification: authorized(rawProtocol.askClarification),
            guideAgent: authorized(rawProtocol.guideAgent),
          }
        : rawProtocol;
    const finishCall =
      fn.resultPolicy !== 'data'
        ? observations?.beginCall(normalizedQualifiedName)
        : undefined;
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
      authorizeCall?.();
      abortSignal?.throwIfAborted();
      if (generation !== observations?.captureGeneration()) {
        throw new AxAIServiceAbortedError(
          'rlm-session',
          'Runtime execution ended before tool dispatch'
        );
      }
      const result = await fn.func(callArgs, {
        abortSignal,
        ai,
        protocol,
        eventContext,
        _mcpExecutionContext: runOptions?._mcpExecutionContext,
        control: runOptions?.control,
        executionPath: `${runOptions?.executionPath ?? 'root'}/${normalizedQualifiedName}`,
      });
      functionCallRecorder?.({
        qualifiedName: normalizedQualifiedName,
        name: fn.name,
        arguments: serializeForEval(callArgs),
        result: serializeForEval(result),
      });
      if (fn.resultPolicy !== 'data') {
        observations?.recordResult(resultName, result, generation);
      }
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
      if (!observations?.isPause(err)) {
        observations?.recordResult(
          resultName,
          {
            error: err instanceof Error ? err.message : String(err),
          },
          generation
        );
      }
      throw err;
    } finally {
      finishCall?.();
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
  getCurrentMemories?: () => readonly AxAgentMemoryResult[],
  runOptions?: Pick<
    import('../../ai/types.js').AxAIServiceOptions,
    'control' | 'executionPath'
  >,
  observations?: TurnObservations
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
  const batchFunctions = new Map<
    string,
    (args: unknown[], label: string, authorize: () => void) => Promise<unknown>
  >();
  const ensureDiscovered = (names: string | string[]) => {
    if (!observations || !s.functionDiscoveryEnabled) return;
    const missing = [
      ...new Set(typeof names === 'string' ? [names] : names),
    ].filter(
      (name) =>
        callableLookup.has(name) &&
        !s.currentDiscoveryPromptState?.functions.has(name)
    );
    if (missing.length === 0) return;
    onDiscoveredFunctions?.(
      missing,
      Object.fromEntries(
        missing.map((name) => [
          name,
          renderDiscoveryFunctionDefinitionsMarkdown([name], callableLookup),
        ])
      )
    );
    onDiscoveredNamespaces?.(
      resolveDiscoveryCallableNamespaces(missing, callableLookup)
    );
    observations.finishDiscovery();
  };
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
  const eventContext = s._activeEventContext as
    | import('../../event/types.js').AxEventContext
    | undefined;
  const bindFunction = (
    fn: AxFunction,
    qualifiedName: string,
    kind: 'internal' | 'external'
  ) => {
    const bind = (authorize?: () => void, label?: string) =>
      wrapFunction(
        fn,
        abortSignal,
        ai,
        protocolForTrigger,
        qualifiedName,
        functionCallRecorder,
        kind,
        onFunctionCall,
        eventContext,
        { ...runOptions, _mcpExecutionContext: s._activeMCPExecutionContext },
        observations,
        () => ensureDiscovered(qualifiedName),
        authorize,
        label
      );
    batchFunctions.set(qualifiedName, (args, label, authorize) =>
      bind(authorize, label)(...args)
    );
    return bind();
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
      ? bindFunction(agentFn, qualifiedName, agentFn._kind ?? 'external')
      : buildStageToolStub(qualifiedName);
    if (agentFn._alwaysInclude !== true) {
      registerCallable(
        {
          module: ns,
          name: agentFn.name,
          description: agentFn.description,
          parameters: agentFn.parameters,
          returns: agentFn.returns,
          resultPolicy: agentFn.resultPolicy,
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
          ? bindFunction(binding, qualifiedName, 'external')
          : buildStageToolStub(qualifiedName);
        registerCallable(
          {
            module: `mcp.${namespace}`,
            name: binding.name,
            description: binding.description,
            parameters: binding.parameters,
            returns: binding.returns,
            resultPolicy: binding.resultPolicy,
          },
          qualifiedName
        );
      }
      const executeOrStub = <T extends (...args: any[]) => Promise<unknown>>(
        qualifiedName: string,
        fn: T
      ): T | ReturnType<typeof buildStageToolStub> => {
        if (!executesTools) return buildStageToolStub(qualifiedName);
        const bind =
          (authorize?: () => void, label = qualifiedName) =>
          async (...args: Parameters<T>) => {
            if (authorize) authorize();
            else observations?.assertCanAct();
            abortSignal?.throwIfAborted();
            const generation = observations?.captureGeneration();
            const finishCall = observations?.beginCall(qualifiedName);
            try {
              const result = await fn(...args);
              observations?.recordResult(label, result, generation);
              return result;
            } catch (error) {
              observations?.recordResult(
                label,
                {
                  error: error instanceof Error ? error.message : String(error),
                },
                generation
              );
              throw error;
            } finally {
              finishCall?.();
            }
          };
        batchFunctions.set(qualifiedName, (args, label, authorize) =>
          bind(authorize, label)(...(args as Parameters<T>))
        );
        return bind() as T;
      };
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
          ? bindFunction(binding, qualifiedName, 'external')
          : buildStageToolStub(qualifiedName);
        registerCallable(
          {
            module: `ucp.${namespace}`,
            name: binding.name,
            description: binding.description,
            parameters: binding.parameters,
            returns: binding.returns,
            resultPolicy: binding.resultPolicy,
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

  if (executesTools) {
    // The actor supplies every argument before dispatch. No generated callback
    // can inspect one result and choose another action inside this batch.
    globals.batch = async (input: unknown) => {
      observations?.assertCanAct();
      const generation = observations?.captureGeneration();
      if (!Array.isArray(input) || input.length === 0) {
        throw new Error(
          'batch requires a non-empty array of { name, args } calls.'
        );
      }
      const calls = input.map((item: unknown) => {
        if (
          !item ||
          typeof item !== 'object' ||
          !('name' in item) ||
          typeof item.name !== 'string'
        ) {
          throw new Error(
            'Each batch call requires a qualified function name and optional args.'
          );
        }
        const binding = batchFunctions.get(item.name);
        if (!binding) throw new Error(`Unknown batch function: ${item.name}`);
        const args = 'args' in item ? item.args : {};
        if (args === null || typeof args !== 'object') {
          throw new Error(
            `Batch args for ${item.name} must be an object or positional array.`
          );
        }
        return {
          name: item.name,
          binding,
          args: Array.isArray(args) ? args : [args],
        };
      });
      // Load ALL missing contracts before running ANY calls. This prevents
      // partial side effects and one discovery turn per batch member.
      ensureDiscovered(calls.map((call) => call.name));
      const finish = observations?.beginCall('batch');
      const results: unknown[] = new Array(calls.length);
      let terminal: { error: unknown } | undefined;
      let next = 0;
      const authorize = () => {
        abortSignal?.throwIfAborted();
        if (generation !== observations?.captureGeneration()) {
          throw new AxAIServiceAbortedError(
            'rlm-session',
            'Runtime execution ended before batch dispatch'
          );
        }
        if (terminal) throw terminal.error;
      };
      const isTerminal = (error: unknown) =>
        error instanceof AxAgentProtocolCompletionSignal ||
        error instanceof AxAgentClarificationError ||
        error instanceof AxAIServiceAbortedError ||
        (error instanceof Error && error.name === 'AbortError') ||
        s.shouldBubbleUserError?.(error) ||
        abortSignal?.aborted === true;
      try {
        await Promise.all(
          Array.from(
            { length: Math.min(calls.length, DEFAULT_RLM_BATCH_CONCURRENCY) },
            async () => {
              while (next < calls.length && !terminal) {
                const index = next++;
                const call = calls[index]!;
                const label = `batch[${index}] ${call.name}`;
                try {
                  authorize();
                  const value = await call.binding(call.args, label, authorize);
                  results[index] = {
                    name: call.name,
                    status: 'fulfilled',
                    value,
                  };
                } catch (error) {
                  if (isTerminal(error)) terminal ??= { error };
                  const message =
                    error instanceof Error ? error.message : String(error);
                  results[index] = {
                    name: call.name,
                    status: 'rejected',
                    error: message,
                  };
                  if (observations?.isPause(error)) {
                    observations.recordResult(
                      label,
                      { error: message },
                      generation
                    );
                  }
                }
              }
            }
          )
        );
        if (terminal) throw terminal.error;
        abortSignal?.throwIfAborted();
        return results;
      } finally {
        finish?.();
      }
    };
  }

  if (s.functionDiscoveryEnabled || typeof s.onSkillsSearch === 'function') {
    globals[DISCOVERY_DISCOVER_NAME] = async (
      input: unknown
    ): Promise<void> => {
      observations?.assertCanAct();
      const generation = observations?.captureGeneration();
      const finishCall = observations?.beginCall(DISCOVERY_DISCOVER_NAME);
      try {
        await fireInternal(DISCOVERY_DISCOVER_NAME, { request: input });
        if (generation !== observations?.captureGeneration()) return;
        const { tools, skills } = normalizeDiscoverInput(input, {
          toolsEnabled: Boolean(s.functionDiscoveryEnabled),
          skillsEnabled: typeof s.onSkillsSearch === 'function',
        });

        if (tools.length > 0) {
          const modules = sortDiscoveryModules(
            tools.filter((item) => moduleLookup.has(item))
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
            const found = items.filter((item) => callableLookup.has(item));
            const missing = items.filter((item) => !callableLookup.has(item));
            const matchedNamespaces = resolveDiscoveryCallableNamespaces(
              found,
              callableLookup
            );
            if (matchedNamespaces.length > 0) {
              onDiscoveredNamespaces?.(matchedNamespaces);
            }
            const docs = Object.fromEntries(
              found.map((qualifiedName) => [
                qualifiedName,
                renderDiscoveryFunctionDefinitionsMarkdown(
                  [qualifiedName],
                  callableLookup
                ),
              ])
            );
            if (found.length > 0) onDiscoveredFunctions?.(found, docs);
            if (missing.length > 0) {
              // A failed lookup is feedback, never a loaded callable contract.
              // Remove negative entries restored from older continuation state.
              for (const name of missing)
                s.currentDiscoveryPromptState?.functions.delete(name);
              const availableModules = sortDiscoveryModules([
                ...moduleLookup.keys(),
              ]);
              const availableFunctions = [...callableLookup.keys()].sort();
              observations?.recordResult(
                DISCOVERY_DISCOVER_NAME,
                {
                  error:
                    'No callable found in the discovery catalog for these names. Discovery did not create them.',
                  notFound: missing,
                  availableModules: availableModules.slice(0, 8),
                  ...(availableFunctions.length <= 8
                    ? { availableFunctions }
                    : {}),
                  nextStep:
                    'Discover an available module to list its functions, then discover a qualified function from that list. Only documented callables can run.',
                },
                generation
              );
            }
          }
        }

        if (skills.length > 0) {
          const results = await s.onSkillsSearch(skills);
          if (generation !== observations?.captureGeneration()) return;
          if (Array.isArray(results) && results.length > 0) {
            onLoadedSkills?.(results as readonly AxAgentSkillResult[]);
          }
        }
        observations?.finishDiscovery(generation);
      } finally {
        finishCall?.();
      }
    };
  }

  if (typeof s.onMemoriesSearch === 'function') {
    globals[MEMORIES_LOAD_NAME] = async (input: unknown): Promise<void> => {
      observations?.assertCanAct();
      const generation = observations?.captureGeneration();
      const finishCall = observations?.beginCall(MEMORIES_LOAD_NAME);
      try {
        await fireInternal(MEMORIES_LOAD_NAME, { searches: input });
        if (generation !== observations?.captureGeneration()) return;
        const searches = normalizeMemoriesInput(input);
        if (searches.length === 0) return;
        const alreadyLoaded = getCurrentMemories?.() ?? [];
        const results = await s.onMemoriesSearch(searches, alreadyLoaded);
        if (generation !== observations?.captureGeneration()) return;
        if (Array.isArray(results) && results.length > 0) {
          onLoadedMemories?.(results as readonly AxAgentMemoryResult[]);
        }
        observations?.finishDiscovery(generation);
      } finally {
        finishCall?.();
      }
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
