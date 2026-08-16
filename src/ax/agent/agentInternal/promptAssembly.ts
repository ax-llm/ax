import {
  axBuildDistillerDefinition,
  axBuildExecutorDefinition,
  getRuntimePrimitiveOverrides,
} from '../rlm.js';
import type { AxStageDefinitionBuildOptions } from './agentInternalTypes.js';
import { type AxAgentStagePolicy, resolveStagePolicy } from './stagePolicy.js';

export function renderActorDefinition(self: any): string {
  const s = self as any;
  if (!s.actorDefinitionBuildOptions) {
    return s.baseActorDefinition;
  }

  const stagePolicy: AxAgentStagePolicy =
    s.stagePolicy ?? resolveStagePolicy(s.options?.stageVariant);
  const protocolCallables = protocolActorCallableMetadata(s);
  const hasProtocolAuthority = protocolCallables.length > 0;
  const buildOptions: AxStageDefinitionBuildOptions = {
    ...s.actorDefinitionBuildOptions,
    // Protocol operations are live runtime bindings, resolved per forward.
    // Merge their real callable paths into the dynamic actor definition rather
    // than exposing them as provider-native tools on the backing AxGen.
    agentFunctions: [
      ...(s.actorDefinitionBuildOptions.agentFunctions ?? []),
      ...protocolCallables,
    ],
    availableModules: mergeProtocolModules(
      s.actorDefinitionBuildOptions.availableModules ?? [],
      protocolCallables
    ),
    // A distiller constructed without local functions is normally
    // respond-only. Live MCP/UCP authority means an executor phase exists, so
    // restore the normal final() handoff (and optional direct-response rule).
    directRespondOnly:
      s.actorDefinitionBuildOptions.directRespondOnly && !hasProtocolAuthority,
    directRespondMode:
      s.actorDefinitionBuildOptions.directRespondMode ||
      (stagePolicy.variant === 'distiller' &&
        s.directRespondEnabled === true &&
        hasProtocolAuthority),
    templateOverride: s._actorTemplateOverrides?.get(s._actorTemplateId()),
    primitiveOverrides: getRuntimePrimitiveOverrides(
      s.runtime,
      s._primitiveOverrides
    ),
  };
  if (stagePolicy.templateId === 'rlm/distiller.md') {
    return axBuildDistillerDefinition(
      s.actorDefinitionBaseDescription,
      s.actorDefinitionContextFields,
      buildOptions
    );
  }
  return axBuildExecutorDefinition(
    s.actorDefinitionBaseDescription,
    s.actorDefinitionContextFields,
    s.actorDefinitionResponderOutputFields,
    buildOptions
  );
}

type ActorCallableMetadata = NonNullable<
  AxStageDefinitionBuildOptions['agentFunctions']
>[number];

/** Metadata for live MCP/UCP operations under their actual runtime paths. */
function protocolActorCallableMetadata(
  self: any
): readonly ActorCallableMetadata[] {
  const s = self as any;
  const executionContext = s._activeMCPExecutionContext as
    | import('../../mcp/execution.js').AxMCPExecutionContext
    | undefined;
  if (!executionContext) return [];

  return executionContext.getToolBindings().flatMap((binding) => {
    const protocol = binding.protocol;
    if (!protocol) return [];
    const namespace =
      protocol.kind === 'mcp'
        ? `mcp.${protocol.namespace}.tools`
        : `ucp.${protocol.namespace}`;
    return [
      {
        name: binding.name,
        description: binding.description,
        parameters: binding.parameters,
        returns: binding.returns,
        namespace,
        // With discovery enabled these are loaded through their protocol
        // module. Otherwise they are rendered inline with local functions.
        alwaysInclude: !s.functionDiscoveryEnabled,
      },
    ];
  });
}

function mergeProtocolModules(
  baseModules: NonNullable<AxStageDefinitionBuildOptions['availableModules']>,
  callables: readonly ActorCallableMetadata[]
): NonNullable<AxStageDefinitionBuildOptions['availableModules']> {
  const modules = new Map(
    baseModules.map((module) => [module.namespace, module])
  );
  for (const callable of callables) {
    const namespace = callable.namespace.endsWith('.tools')
      ? callable.namespace.slice(0, -'.tools'.length)
      : callable.namespace;
    if (!modules.has(namespace)) {
      modules.set(namespace, {
        namespace,
        selectionCriteria: `Use operations from ${namespace}.`,
      });
    }
  }
  return [...modules.values()];
}

export function buildActorInstruction(self: any): string {
  const s = self as any;
  return renderActorDefinition(s).trim();
}
