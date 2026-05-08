import {
  axBuildDistillerDefinition,
  axBuildExecutorDefinition,
} from '../rlm.js';
import { renderDiscoveryPromptMarkdown } from './discoveryHelpers.js';
import { renderSkillsPromptMarkdown } from './skillsHelpers.js';

export function renderActorDefinition(self: any): string {
  const s = self as any;
  if (!s.actorDefinitionBuildOptions) {
    return s.baseActorDefinition;
  }

  const skillsMarkdown =
    typeof s.onSkillsSearch === 'function' && s.currentSkillsPromptState
      ? renderSkillsPromptMarkdown(s.currentSkillsPromptState)
      : undefined;

  const buildOptions = {
    ...s.actorDefinitionBuildOptions,
    discoveredDocsMarkdown: renderDiscoveryPromptMarkdown(
      s.currentDiscoveryPromptState
    ),
    templateOverride: s._actorTemplateOverrides?.get(s._actorTemplateId()),
    primitiveOverrides: s._primitiveOverrides,
  };
  const variant = s.options?.stageVariant as
    | 'distiller'
    | 'executor'
    | undefined;
  if (variant === 'distiller') {
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
    {
      ...buildOptions,
      skillsMarkdown,
    }
  );
}

export function buildActorInstruction(self: any): string {
  const s = self as any;
  return renderActorDefinition(s).trim();
}
