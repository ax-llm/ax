/**
 * Host-side security configuration helpers for AxJSRuntime.
 *
 * This module intentionally contains no worker-session state. It normalizes the
 * public security options into runtime/worker flags used by jsRuntime.ts and
 * jsRuntimeWorkers.ts.
 */

/**
 * Permissions that can be granted to the RLM JS interpreter sandbox.
 * By default all dangerous globals are blocked; users opt in via this enum.
 */
export enum AxJSRuntimePermission {
  /** fetch, XMLHttpRequest, WebSocket, EventSource */
  NETWORK = 'network',
  /** indexedDB, caches */
  STORAGE = 'storage',
  /** importScripts */
  CODE_LOADING = 'code-loading',
  /** BroadcastChannel */
  COMMUNICATION = 'communication',
  /** performance */
  TIMING = 'timing',
  /**
   * Worker, SharedWorker.
   * Warning: sub-workers spawn with fresh, unlocked globals — granting
   * WORKERS without other restrictions implicitly grants all capabilities
   * (e.g. fetch, indexedDB) inside child workers.
   */
  WORKERS = 'workers',
  /** node:fs and related — gates Node Permission Model --allow-fs-* and Deno read/write */
  FILESYSTEM = 'filesystem',
  /** node:child_process — gates --allow-child-process and Deno run */
  CHILD_PROCESS = 'child-process',
}

/**
 * Fine-grained Node Permission Model allowlist. Scopes `--allow-fs-*` and
 * gates additional `--allow-*` flags that aren't covered by the high-level
 * permission enum.
 */
export type AxJSRuntimeNodePermissionAllowlist = Readonly<{
  fsRead?: readonly string[];
  fsWrite?: readonly string[];
  childProcess?: boolean;
  addons?: boolean;
  wasi?: boolean;
}>;

/**
 * Node worker_threads resource limits passthrough.
 */
export type AxJSRuntimeResourceLimits = Readonly<{
  maxOldGenerationSizeMb?: number;
  maxYoungGenerationSizeMb?: number;
  codeRangeSizeMb?: number;
  stackSizeMb?: number;
}>;

/** Parses `process.versions.node` into { major, minor } (null if unavailable). */
const detectNodeMajorMinor = (): { major: number; minor: number } | null => {
  const nodeVersion = (
    globalThis as { process?: { versions?: { node?: string } } }
  ).process?.versions?.node;
  if (!nodeVersion) {
    return null;
  }
  const match = /^(\d+)\.(\d+)/.exec(nodeVersion);
  if (!match) {
    return null;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) {
    return null;
  }
  return { major, minor };
};

/**
 * Permission Model flavor for the detected Node runtime:
 *   - 'stable'       -> Node >= 23.5 (uses `--permission`)
 *   - 'experimental' -> Node >= 20 and < 23.5 (uses `--experimental-permission`)
 *   - null           -> not supported (Node < 20, or non-Node runtime)
 *
 * The `--allow-*` sub-flags have been present since Node 20.0, so both flavors
 * accept the same allow-list. `--allow-addons` (20.7) and `--allow-wasi` (20.8)
 * are also accepted on every supported version.
 */
type NodePermissionFlavor = 'stable' | 'experimental';

const nodePermissionFlavor = (): NodePermissionFlavor | null => {
  const v = detectNodeMajorMinor();
  if (!v) return null;
  if (v.major > 23 || (v.major === 23 && v.minor >= 5)) return 'stable';
  if (v.major >= 20) return 'experimental';
  return null;
};

/**
 * Builds execArgv for the Node Permission Model. Emits `--permission` on
 * Node 23.5+ (stable flag) and `--experimental-permission` on Node 20-23.4
 * (experimental flag: same runtime enforcement, just not yet promoted).
 *
 * Hard-fails on Node < 20 when permission-model mode is forced.
 */
const buildPermissionExecArgv = (
  permissions: readonly AxJSRuntimePermission[],
  flavor: NodePermissionFlavor | null,
  extra?: Readonly<{
    nodePermissionAllowlist?: AxJSRuntimeNodePermissionAllowlist;
  }>
): string[] => {
  if (flavor == null) {
    const v = detectNodeMajorMinor();
    const detected = v ? `${v.major}.${v.minor}` : 'unknown';
    throw new Error(
      `useNodePermissionModel requires Node 20+ (detected ${detected}). ` +
        `Node 23.5+ uses --permission; Node 20-23.4 uses --experimental-permission.`
    );
  }
  const gate =
    flavor === 'stable' ? '--permission' : '--experimental-permission';
  const out: string[] = [gate];
  const p = new Set(permissions);
  const allow = extra?.nodePermissionAllowlist;

  if (
    p.has(AxJSRuntimePermission.FILESYSTEM) ||
    (allow?.fsRead?.length ?? 0) > 0
  ) {
    for (const path of allow?.fsRead ?? ['*']) {
      out.push(`--allow-fs-read=${path}`);
    }
  }
  if (
    p.has(AxJSRuntimePermission.FILESYSTEM) ||
    (allow?.fsWrite?.length ?? 0) > 0
  ) {
    for (const path of allow?.fsWrite ?? ['*']) {
      out.push(`--allow-fs-write=${path}`);
    }
  }
  if (p.has(AxJSRuntimePermission.CHILD_PROCESS) || allow?.childProcess) {
    out.push('--allow-child-process');
  }
  if (p.has(AxJSRuntimePermission.WORKERS)) {
    out.push('--allow-worker');
  }
  if (allow?.addons) {
    out.push('--allow-addons');
  }
  if (allow?.wasi) {
    out.push('--allow-wasi');
  }
  return out;
};

export const computeNodePermissionExecArgv = ({
  mode,
  permissions,
  nodePermissionAllowlist,
}: Readonly<{
  mode: boolean | 'auto';
  permissions: readonly AxJSRuntimePermission[];
  nodePermissionAllowlist?: AxJSRuntimeNodePermissionAllowlist;
}>): string[] | undefined => {
  if (mode === false) {
    return undefined;
  }
  const flavor = nodePermissionFlavor();
  if (mode === true) {
    if (flavor == null) {
      const v = detectNodeMajorMinor();
      const detected = v ? `${v.major}.${v.minor}` : 'unknown';
      throw new Error(
        `useNodePermissionModel=true requires Node 20+ (detected ${detected}). ` +
          `Node 23.5+ uses --permission; Node 20-23.4 uses --experimental-permission.`
      );
    }
    return buildPermissionExecArgv(permissions, flavor, {
      nodePermissionAllowlist,
    });
  }

  // 'auto': engage the Permission Model unconditionally on supported Node
  // versions. Without FILESYSTEM/CHILD_PROCESS permissions this still blocks
  // fs and process access at the runtime level if a language-level escape is
  // found later. Unsupported runtimes fall back to language-level defenses.
  if (flavor == null) {
    return undefined;
  }
  return buildPermissionExecArgv(permissions, flavor, {
    nodePermissionAllowlist,
  });
};

/**
 * Maps RLM sandbox permissions to Deno worker permissions.
 *
 * Conservative mapping:
 * - NETWORK => net: true
 * - Others currently have no direct Deno permission equivalent
 *
 * Default is "none" for a tighter sandbox when running in Deno.
 */
let warnedDenoImportUnsupported = false;

export const mapRlmPermissionsToDenoPermissions = (
  permissions: readonly AxJSRuntimePermission[],
  extra?: Readonly<{ allowDenoRemoteImport?: boolean }>
): unknown => {
  const granted = new Set(permissions);
  const denoPermissions: Record<string, unknown> = {};

  if (granted.has(AxJSRuntimePermission.NETWORK)) {
    denoPermissions.net = true;
    // Critical: granting --allow-net also enables remote module loading by
    // default. Explicitly deny remote import unless the caller opts in.
    if (!extra?.allowDenoRemoteImport) {
      try {
        denoPermissions.import = false;
      } catch {
        if (!warnedDenoImportUnsupported) {
          warnedDenoImportUnsupported = true;
          console.warn(
            '[AxJSRuntime] Deno runtime does not support the `import` permission; ' +
              'remote module imports via `import("https://...")` are NOT blocked. ' +
              'Upgrade Deno to a version supporting --deny-import.'
          );
        }
      }
    }
  }

  if (granted.has(AxJSRuntimePermission.FILESYSTEM)) {
    denoPermissions.read = true;
    denoPermissions.write = true;
  }

  if (granted.has(AxJSRuntimePermission.CHILD_PROCESS)) {
    denoPermissions.run = true;
  }

  return Object.keys(denoPermissions).length > 0 ? denoPermissions : 'none';
};

/**
 * Canonicalizes a value for stable hashing. Array elements are sorted to
 * ensure permutation-equivalent inputs hash identically for worker-pool keys
 * and security-posture comparisons.
 */
export const canonicalizeForHash = (value: unknown): string => {
  const canon = (v: unknown): unknown => {
    if (Array.isArray(v)) {
      const mapped = v.map((el) => canon(el));
      return [...mapped].sort((a, b) =>
        JSON.stringify(a) < JSON.stringify(b) ? -1 : 1
      );
    }
    if (v && typeof v === 'object') {
      const entries = Object.entries(v as Record<string, unknown>)
        .filter(([, val]) => val !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : 1));
      const out: Record<string, unknown> = {};
      for (const [k, val] of entries) {
        out[k] = canon(val);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(canon(value));
};

export const computeSecurityPostureHash = (
  options: Readonly<{
    permissions: readonly AxJSRuntimePermission[];
    allowUnsafeNodeHostAccess: boolean;
    blockDynamicImport: boolean;
    allowedModules: readonly string[];
    freezeIntrinsics: boolean;
    blockShadowRealm: boolean;
    lockWorkerIPC: boolean;
    preventGlobalThisExtensions: boolean;
  }>
): string =>
  canonicalizeForHash({
    permissions: [...options.permissions],
    allowUnsafeNodeHostAccess: options.allowUnsafeNodeHostAccess,
    blockDynamicImport: options.blockDynamicImport,
    allowedModules: [...options.allowedModules],
    freezeIntrinsics: options.freezeIntrinsics,
    blockShadowRealm: options.blockShadowRealm,
    lockWorkerIPC: options.lockWorkerIPC,
    preventGlobalThisExtensions: options.preventGlobalThisExtensions,
  });
