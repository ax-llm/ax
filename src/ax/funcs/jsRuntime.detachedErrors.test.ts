import { expect, it } from 'vitest';
import { AxJSRuntime } from './jsRuntime.js';

it.each([
  '(async () => { await missingTool(); })();',
  'void Promise.resolve().then(() => { throw new Error("missingTool"); });',
])('returns detached code errors to the owning turn: %s', async (code) => {
  const session = new AxJSRuntime({ outputMode: 'stdout' }).createSession();
  try {
    await session.execute('var retained = 42;');
    const result = await session.executeWithStatus!(code).catch((error) => ({
      value: error,
      isError: true,
    }));
    expect(result.isError).toBe(true);
    expect(String(result.value)).toContain('missingTool');
    await session.patchGlobals({ next: 'ready' });
    expect(await session.execute('console.log(retained, next)')).toBe(
      '42 ready'
    );
  } finally {
    await session.close();
  }
});

it('does not report a detached rejection that the program handles', async () => {
  const session = new AxJSRuntime({ outputMode: 'stdout' }).createSession();
  try {
    const result = await session.executeWithStatus!(
      'void Promise.reject(new Error("handled")).catch(() => console.log("recovered"));'
    );
    expect(result).toEqual({ value: 'recovered', isError: false });
  } finally {
    await session.close();
  }
});
