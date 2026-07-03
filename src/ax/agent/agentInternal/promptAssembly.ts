import {
  axBuildDistillerDefinition,
  axBuildExecutorDefinition,
  getRuntimePrimitiveOverrides,
} from '../rlm.js';
import { type AxAgentStagePolicy, resolveStagePolicy } from './stagePolicy.js';

export function renderActorDefinition(self: any): string {
  const s = self as any;
  if (!s.actorDefinitionBuildOptions) {
    return s.baseActorDefinition;
  }

  const buildOptions = {
    ...s.actorDefinitionBuildOptions,
    templateOverride: s._actorTemplateOverrides?.get(s._actorTemplateId()),
    primitiveOverrides: getRuntimePrimitiveOverrides(
      s.runtime,
      s._primitiveOverrides
    ),
  };
  const stagePolicy: AxAgentStagePolicy =
    s.stagePolicy ?? resolveStagePolicy(s.options?.stageVariant);
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

export function buildActorInstruction(self: any): string {
  const s = self as any;
  return renderActorDefinition(s).trim();
}
