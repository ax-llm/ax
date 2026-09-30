/** Preserve the explicit completion protocol used by legacy scripted fixtures.
 * Runtime-backed fixtures retain their runtime actors. New default-mode tests
 * should construct their fixtures directly, without this migration adapter.
 */
export function legacyCompletionFixture<T extends Record<string, unknown>>(
  fixture: T
): T {
  const scriptedAgent = [
    'agent_forward',
    'agent_streaming_forward',
    'agent_playbook_evolve',
    'agent_playbook_coverage',
  ].includes(String(fixture.kind));
  const optimizedAgent =
    fixture.kind === 'optimize' && (fixture.program ?? 'agent') === 'agent';
  if (!scriptedAgent && !optimizedAgent && fixture.kind !== undefined)
    return fixture;
  const options = { ...((fixture.options ?? {}) as Record<string, unknown>) };
  const hasRuntime =
    ['runtime', 'runtimeConfig', 'runtime_config'].some(
      (key) => options[key] != null
    ) ||
    [
      'runtime_script',
      'runtime_engine',
      'runtime_on_evolve',
      'runtime_on_forward',
    ].some((key) => fixture[key] != null);
  if (
    !hasRuntime &&
    options.actorMode === undefined &&
    options.actor_mode === undefined
  )
    options.actorMode = 'completion';
  const result = { ...fixture, options };
  if (Array.isArray(fixture.child_agents)) {
    Object.assign(result, {
      child_agents: fixture.child_agents.map((child) =>
        legacyCompletionFixture(child)
      ),
    });
  }
  if (Array.isArray(fixture.forward_runs)) {
    Object.assign(result, {
      forward_runs: fixture.forward_runs.map((run) =>
        run.without_runtime
          ? {
              ...run,
              forward_options: {
                ...run.forward_options,
                actorMode: 'completion',
              },
            }
          : run
      ),
    });
  }
  return result;
}
