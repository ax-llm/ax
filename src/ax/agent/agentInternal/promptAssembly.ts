import {
  axBuildActorDefinition,
  axBuildContextActorDefinition,
  axBuildTaskActorDefinition,
} from '../rlm.js';
import { renderDiscoveryPromptMarkdown } from './discoveryHelpers.js';

export function renderActorDefinition(self: any): string {
  const s = self as any;
  if (!s.actorDefinitionBuildOptions) {
    return s.baseActorDefinition;
  }

  const buildOptions = {
    ...s.actorDefinitionBuildOptions,
    discoveredDocsMarkdown: renderDiscoveryPromptMarkdown(
      s.currentDiscoveryPromptState
    ),
    templateOverride: s._actorTemplateOverrides?.get(s._actorTemplateId()),
    primitiveOverrides: s._primitiveOverrides,
  };
  const variant = s.options?.actorTemplateVariant ?? 'combined';
  if (variant === 'context') {
    return axBuildContextActorDefinition(
      s.actorDefinitionBaseDescription,
      s.actorDefinitionContextFields,
      buildOptions
    );
  }
  if (variant === 'task') {
    return axBuildTaskActorDefinition(
      s.actorDefinitionBaseDescription,
      s.actorDefinitionContextFields,
      s.actorDefinitionResponderOutputFields,
      {
        ...buildOptions,
        hasDistilledContext: s.options?.hasDistilledContext ?? false,
      }
    );
  }
  return axBuildActorDefinition(
    s.actorDefinitionBaseDescription,
    s.actorDefinitionContextFields,
    s.actorDefinitionResponderOutputFields,
    buildOptions
  );
}

export function buildActorInstruction(self: any): string {
  const s = self as any;
  return renderActorDefinition(s).trim();
}
