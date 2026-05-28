import {
  axBuildDistillerDefinition,
  axBuildExecutorDefinition,
  getRuntimePrimitiveOverrides,
} from '../rlm.js';

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
    buildOptions
  );
}

export function buildActorInstruction(self: any): string {
  const s = self as any;
  return renderActorDefinition(s).trim();
}
