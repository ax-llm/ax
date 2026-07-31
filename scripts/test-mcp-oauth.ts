import { type ChildProcess, spawn } from 'node:child_process';

import { AxMCPEventDemoServer } from '../src/examples/mcp-event-demo-server.js';
import { AxMCPOAuthDemoAS } from '../src/examples/mcp-oauth-demo-as.js';
import {
  buildGeneratedMCPSmoke,
  type GeneratedMCPSmokeCommand,
  generatedMCPSmokeRoot as root,
} from './lib/generated-mcp-smoke.js';

const requested = process.argv
  .find((value) => value.startsWith('--languages='))
  ?.slice('--languages='.length)
  .split(',')
  .filter(Boolean);
const languages = requested ?? ['python', 'java', 'cpp', 'go', 'rust'];
const discoveryModes = ['well-known', 'challenge'] as const;

for (const language of languages) {
  const command = await buildGeneratedMCPSmoke(language, {
    smokeDirectory: 'mcp-oauth',
    outputName: 'ax-generated-mcp-oauth',
    javaSource: 'GeneratedMcpOAuthSmoke.java',
    javaClass: 'GeneratedMcpOAuthSmoke',
    rustBinary: 'ax-generated-mcp-oauth-smoke',
  });
  for (const discovery of discoveryModes) {
    await runSmoke(language, discovery, false, command);
    await runSmoke(language, discovery, true, command);
  }
}

async function runSmoke(
  language: string,
  discovery: (typeof discoveryModes)[number],
  wrongIssuer: boolean,
  spec: GeneratedMCPSmokeCommand
): Promise<void> {
  const authorizationServer = new AxMCPOAuthDemoAS({
    wrongAuthorizationResponseIssuer: wrongIssuer,
  });
  const portBase =
    22_000 +
    languages.indexOf(language) * 20 +
    discoveryModes.indexOf(discovery) * 4 +
    (wrongIssuer ? 2 : 0);
  const issuer = await authorizationServer.start(portBase);
  let accessTokenValidations = 0;
  const resourceServer = new AxMCPEventDemoServer({
    protectedResource: {
      authorizationServer: issuer,
      discovery,
      validateAccessToken: (token) => {
        accessTokenValidations += 1;
        return authorizationServer.validateAccessToken(token);
      },
    },
  });
  const endpoint = await resourceServer.start(portBase + 1);
  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd ?? root,
    env: {
      ...process.env,
      ...spec.env,
      AX_MCP_ENDPOINT: endpoint,
      AX_MCP_EXPECT_ERROR: wrongIssuer ? 'issuer mismatch' : '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (value) => {
    stdout += String(value);
  });
  child.stderr?.on('data', (value) => {
    stderr += String(value);
  });
  try {
    await waitForExit(child, 20_000);
    const marker = wrongIssuer
      ? 'AX_MCP_OAUTH_EXPECTED_ERROR'
      : 'AX_MCP_OAUTH_OK';
    if (!stdout.includes(marker)) {
      throw new Error(`smoke did not report ${marker}`);
    }
    if (wrongIssuer) {
      if (authorizationServer.getCodeExchangeCount() !== 0) {
        throw new Error('wrong-issuer flow exchanged an authorization code');
      }
    } else if (
      authorizationServer.getCodeExchangeCount() < 1 ||
      authorizationServer.getRefreshExchangeCount() < 1
    ) {
      throw new Error(
        `flow missed exchange or refresh: code=${authorizationServer.getCodeExchangeCount()} refresh=${authorizationServer.getRefreshExchangeCount()}`
      );
    }
    console.log(
      `[generated-mcp-oauth] ${language}/${discovery}/${wrongIssuer ? 'wrong-iss' : 'success'}: pass`
    );
  } catch (error) {
    if (child.exitCode === null) child.kill('SIGKILL');
    throw new Error(
      `${language}/${discovery} generated MCP OAuth smoke failed: ${String(error)}\naccess validations=${accessTokenValidations} code exchanges=${authorizationServer.getCodeExchangeCount()} refresh exchanges=${authorizationServer.getRefreshExchangeCount()}\nstdout:\n${stdout}\nstderr:\n${stderr}`
    );
  } finally {
    await resourceServer.close();
    await authorizationServer.close();
  }
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null) {
    return child.exitCode === 0
      ? Promise.resolve()
      : Promise.reject(new Error(`smoke exited with ${child.exitCode}`));
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('timed out waiting for OAuth smoke completion'));
    }, timeoutMs);
    child.once('exit', (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`smoke exited with ${code}`));
    });
  });
}
