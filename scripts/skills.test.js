import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readTypeScriptSkillBundles } from '../src/ax/scripts/skill-bundles.mjs';
import {
  installSkills,
  removeSkills,
} from '../src/ax/scripts/skill-install.mjs';
import { createSkillArchive } from './skill-archives.mjs';
import {
  readSkillMirrorSources,
  sha256Digest,
  skillArtifact,
  skillIndexEntry,
} from './skill-mirrors.mjs';

const repo = path.resolve(import.meta.dirname, '..');
let root;
let pkg;
let project;
const version = '25.4.1';

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'ax-skills-'));
  pkg = path.join(root, 'package');
  project = path.join(root, 'project');
  mkdirSync(project);
  mkdirSync(pkg);
  for (const dir of ['skills', 'scripts', 'cli'])
    cpSync(path.join(repo, 'src/ax', dir), path.join(pkg, dir), {
      recursive: true,
    });
  writeFileSync(
    path.join(pkg, 'package.json'),
    JSON.stringify({ name: '@ax-llm/ax', version, type: 'module' })
  );
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function skillDir(name = 'ax-llm') {
  return path.join(project, '.claude', 'skills', name);
}
function runCLI(...args) {
  return execFileSync(
    process.execPath,
    [path.join(pkg, 'cli/index.mjs'), ...args],
    { cwd: project, encoding: 'utf8', stdio: 'pipe' }
  );
}

function automaticEnv(target) {
  const env = { ...process.env, INIT_CWD: target };
  for (const key of [
    'CI',
    'CONTINUOUS_INTEGRATION',
    'AX_SKIP_SKILL_INSTALL',
    'GITHUB_ACTIONS',
    'GITLAB_CI',
    'CIRCLECI',
    'TRAVIS',
    'JENKINS_URL',
    'BUILDKITE',
    'DRONE',
    'TEAMCITY_VERSION',
    'BITBUCKET_BUILD_NUMBER',
    'CODEBUILD_BUILD_ID',
    'TF_BUILD',
  ])
    delete env[key];
  return env;
}

function runAutomaticInstall(overrides = {}) {
  return execFileSync(
    process.execPath,
    [path.join(pkg, 'scripts/postinstall.mjs')],
    {
      cwd: pkg,
      env: { ...automaticEnv(project), ...overrides },
      stdio: 'pipe',
    }
  );
}

describe('hybrid skill installation', () => {
  it('registers one entry point and resolves every linked local guide offline', () => {
    expect(installSkills(pkg, project)).toEqual(['ax-llm']);
    expect(readdirSync(path.dirname(skillDir()))).toEqual(['ax-llm']);
    const files = readTypeScriptSkillBundles(
      path.join(pkg, 'skills'),
      version
    ).find((skill) => skill.name === 'ax-llm').files;
    for (const [file, content] of Object.entries(files)) {
      expect(readFileSync(path.join(skillDir(), file), 'utf8')).toBe(content);
      for (const match of content.matchAll(/\]\(([^)#]+\.md)(?:#[^)]*)?\)/g)) {
        if (!match[1].startsWith('http'))
          expect(
            existsSync(path.resolve(skillDir(), path.dirname(file), match[1]))
          ).toBe(true);
      }
    }
    expect(Object.keys(files)).toHaveLength(19);
    expect(files['SKILL.md'].split('\n').length).toBeLessThan(90);
    expect(
      Object.keys(files).filter((file) => file.endsWith('SKILL.md'))
    ).toEqual(['SKILL.md']);
  });

  it('supports explicit all-specialist and individual-skill installs', () => {
    runCLI('setup-claude', '--skill', 'ax-ai');
    expect(readdirSync(path.dirname(skillDir()))).toEqual(['ax-ai']);
    expect(
      existsSync(path.join(skillDir('ax-ai'), 'references/ax-typesafe.md'))
    ).toBe(true);
    runCLI('setup-claude', '--all');
    expect(readdirSync(path.dirname(skillDir()))).toHaveLength(18);
  });

  it('rejects an unknown skill before writing any files', () => {
    expect(() =>
      installSkills(pkg, project, { names: ['ax-llm', 'missing'] })
    ).toThrow('Unknown Ax skill');
    expect(existsSync(path.join(project, '.claude'))).toBe(false);
    expect(() => runCLI('setup-claude', '--skill')).toThrow();
  });

  it('upgrades legacy equal-version entry points and keeps existing specialists', () => {
    for (const name of ['ax-llm', 'ax-agent']) {
      mkdirSync(skillDir(name), { recursive: true });
      writeFileSync(
        path.join(skillDir(name), 'SKILL.md'),
        `---\nversion: "${version}"\n---\nOld guide`
      );
    }
    expect(installSkills(pkg, project)).toEqual(['ax-llm']);
    expect(
      readFileSync(path.join(skillDir('ax-agent'), 'SKILL.md'), 'utf8')
    ).toContain('Old guide');
    expect(readFileSync(path.join(skillDir(), 'SKILL.md'), 'utf8')).toContain(
      'Choose A Guide'
    );
    expect(installSkills(pkg, project)).toEqual([]);
  });

  it.each(['\n', '\r\n'])(
    'preserves newer skills with %j line endings unless force is explicit',
    (lineEnding) => {
      mkdirSync(skillDir(), { recursive: true });
      const target = path.join(skillDir(), 'SKILL.md');
      writeFileSync(
        target,
        ['---', 'version: "99.0.0"', '---', 'Newer'].join(lineEnding)
      );
      expect(installSkills(pkg, project)).toEqual([]);
      expect(readFileSync(target, 'utf8')).toContain('Newer');
      expect(installSkills(pkg, project, { force: true })).toEqual(['ax-llm']);
    }
  );

  it.each([false, true])(
    'preserves registration state when guide writes fail (existing: %j)',
    (existing) => {
      mkdirSync(skillDir(), { recursive: true });
      const target = path.join(skillDir(), 'SKILL.md');
      const oldContent = '---\nversion: "1.0.0"\n---\nOriginal guide';
      if (existing) writeFileSync(target, oldContent);
      writeFileSync(path.join(skillDir(), 'references'), 'existing file');
      expect(() => installSkills(pkg, project)).toThrow();
      if (existing) expect(readFileSync(target, 'utf8')).toBe(oldContent);
      else expect(existsSync(target)).toBe(false);
    }
  );

  it('installs the entry point even when an existing specialist cannot update', () => {
    installSkills(pkg, project, { names: ['ax-ai'] });
    const dir = skillDir('ax-ai');
    const target = path.join(dir, 'SKILL.md');
    writeFileSync(
      target,
      readFileSync(target, 'utf8').replace(version, '1.0.0')
    );
    rmSync(path.join(dir, 'references'), { recursive: true });
    writeFileSync(path.join(dir, 'references'), 'existing file');
    execFileSync(
      process.execPath,
      [path.join(pkg, 'scripts/postinstall.mjs')],
      {
        cwd: pkg,
        env: automaticEnv(project),
        stdio: 'pipe',
      }
    );
    expect(existsSync(path.join(skillDir(), 'SKILL.md'))).toBe(true);
    expect(readFileSync(target, 'utf8')).toContain('version: "1.0.0"');
  });

  it.each([
    'CI',
    'CONTINUOUS_INTEGRATION',
    'GITHUB_ACTIONS',
    'AX_SKIP_SKILL_INSTALL',
  ])('honors %s during automatic installation', (variable) => {
    execFileSync(
      process.execPath,
      [path.join(pkg, 'scripts/postinstall.mjs')],
      {
        cwd: project,
        env: { ...automaticEnv(project), [variable]: '1' },
      }
    );
    expect(existsSync(path.join(project, '.claude'))).toBe(false);
  });

  it('uses the package-manager project root during automatic installation', () => {
    const env = automaticEnv(project);
    execFileSync(
      process.execPath,
      [path.join(pkg, 'scripts/postinstall.mjs')],
      { cwd: pkg, env }
    );
    expect(readdirSync(path.dirname(skillDir()))).toEqual(['ax-llm']);
    expect(existsSync(path.join(pkg, '.claude'))).toBe(false);
  });

  it('keeps dependency installation successful when the target cannot be written', () => {
    const target = path.join(root, 'not-a-directory');
    writeFileSync(target, 'existing file');
    execFileSync(
      process.execPath,
      [path.join(pkg, 'scripts/postinstall.mjs')],
      {
        cwd: pkg,
        env: automaticEnv(target),
        stdio: 'pipe',
      }
    );
    expect(readFileSync(target, 'utf8')).toBe('existing file');
  });

  it('updates existing optional specialists without installing additional ones', () => {
    installSkills(pkg, project, { names: ['ax-ai'] });
    const target = path.join(skillDir('ax-ai'), 'SKILL.md');
    writeFileSync(
      target,
      readFileSync(target, 'utf8').replace(version, '1.0.0')
    );
    execFileSync(
      process.execPath,
      [path.join(pkg, 'scripts/postinstall.mjs')],
      {
        cwd: pkg,
        env: automaticEnv(project),
        stdio: 'pipe',
      }
    );
    expect(readdirSync(path.dirname(skillDir())).sort()).toEqual([
      'ax-ai',
      'ax-llm',
    ]);
    expect(readFileSync(target, 'utf8')).toContain(`version: "${version}"`);
  });

  it('removes bundled guides while retaining unrelated files and skills', () => {
    installSkills(pkg, project, { all: true });
    writeFileSync(
      path.join(skillDir(), 'references', 'my-notes.md'),
      'personal'
    );
    mkdirSync(skillDir('other-tool'));
    writeFileSync(path.join(skillDir('other-tool'), 'SKILL.md'), 'unrelated');
    expect(removeSkills(pkg, project)).toBe(18);
    expect(existsSync(path.join(skillDir(), 'SKILL.md'))).toBe(false);
    expect(
      readFileSync(path.join(skillDir(), 'references/my-notes.md'), 'utf8')
    ).toBe('personal');
    expect(
      readFileSync(path.join(skillDir('other-tool'), 'SKILL.md'), 'utf8')
    ).toBe('unrelated');
    expect(removeSkills(pkg, project)).toBe(0);
  });

  it('ships all installer helpers and guides through the npm build packaging step', () => {
    mkdirSync(path.join(pkg, 'dist'));
    execFileSync(process.execPath, [path.join(repo, 'scripts/postbuild.js')], {
      cwd: pkg,
    });
    const dist = path.join(pkg, 'dist');
    expect(
      JSON.parse(readFileSync(path.join(dist, 'package.json'), 'utf8')).scripts
        .postinstall
    ).toBe('node ./scripts/postinstall.mjs');
    expect(installSkills(dist, project)).toEqual(['ax-llm']);
    execFileSync(
      process.execPath,
      [path.join(dist, 'cli/index.mjs'), 'setup-claude', '--skill', 'ax-ai'],
      { cwd: project }
    );
    expect(readdirSync(path.dirname(skillDir())).sort()).toEqual([
      'ax-ai',
      'ax-llm',
    ]);
    writeFileSync(path.join(project, 'package.json'), '{}\n');
    execFileSync(
      process.execPath,
      [path.join(dist, 'cli/index.mjs'), 'skills-auto-install', 'off'],
      { cwd: project }
    );
    removeSkills(dist, project);
    execFileSync(
      process.execPath,
      [path.join(dist, 'scripts/postinstall.mjs')],
      {
        cwd: dist,
        env: automaticEnv(project),
      }
    );
    expect(existsSync(path.join(skillDir(), 'SKILL.md'))).toBe(false);
  });
});

describe('persistent automatic setup preference', () => {
  beforeEach(() => {
    writeFileSync(path.join(project, 'package.json'), '{"name":"consumer"}\n');
  });

  it('remembers opt-out across package upgrades without touching installed specialists', () => {
    installSkills(pkg, project, { names: ['ax-ai'] });
    const target = path.join(skillDir('ax-ai'), 'SKILL.md');
    const original = readFileSync(target, 'utf8');
    runCLI('skills-auto-install', 'off');
    const manifest = path.join(project, 'package.json');
    const saved = readFileSync(manifest, 'utf8');
    expect(JSON.parse(saved).ax.skills.autoInstall).toBe(false);
    runAutomaticInstall();
    const packageManifest = path.join(pkg, 'package.json');
    writeFileSync(
      packageManifest,
      readFileSync(packageManifest, 'utf8').replace(version, '25.4.2')
    );
    runAutomaticInstall({ AX_SKIP_SKILL_INSTALL: '0' });
    expect(readdirSync(path.dirname(skillDir()))).toEqual(['ax-ai']);
    expect(readFileSync(target, 'utf8')).toBe(original);
    expect(readFileSync(manifest, 'utf8')).toBe(saved);
  });

  it('allows explicit setup and removal without clearing the preference', () => {
    runCLI('skills-auto-install', 'off');
    expect(existsSync(path.join(project, '.claude'))).toBe(false);
    runAutomaticInstall();
    expect(existsSync(path.join(project, '.claude'))).toBe(false);
    runCLI('setup-claude');
    expect(existsSync(path.join(skillDir(), 'SKILL.md'))).toBe(true);
    runCLI('remove-claude');
    runAutomaticInstall();
    expect(existsSync(path.join(skillDir(), 'SKILL.md'))).toBe(false);
    expect(
      JSON.parse(readFileSync(path.join(project, 'package.json'), 'utf8')).ax
        .skills.autoInstall
    ).toBe(false);
  });

  it('restores automatic setup when re-enabled', () => {
    runCLI('skills-auto-install', 'off');
    runAutomaticInstall();
    expect(existsSync(path.join(project, '.claude'))).toBe(false);
    runCLI('skills-auto-install', 'on');
    expect(existsSync(path.join(project, '.claude'))).toBe(false);
    runAutomaticInstall();
    expect(readdirSync(path.dirname(skillDir()))).toEqual(['ax-llm']);
    expect(
      JSON.parse(readFileSync(path.join(project, 'package.json'), 'utf8')).ax
        .skills.autoInstall
    ).toBe(true);
  });

  it.each(['CI', 'AX_SKIP_SKILL_INSTALL'])(
    'still honors %s after automatic setup is re-enabled',
    (variable) => {
      runCLI('skills-auto-install', 'on');
      runAutomaticInstall({ [variable]: '1' });
      expect(existsSync(path.join(project, '.claude'))).toBe(false);
    }
  );

  it.each([
    ['  ', '\n'],
    ['\t', '\r\n'],
  ])(
    'preserves unrelated settings, indentation %j, and line endings %j',
    (indent, newline) => {
      const config = {
        name: 'consumer',
        scripts: { test: 'echo test' },
        dependencies: { '@ax-llm/ax': '^25.4.1' },
        ax: { custom: 'retained', skills: { custom: ['retained'] } },
      };
      const manifest = path.join(project, 'package.json');
      writeFileSync(
        manifest,
        JSON.stringify(config, null, indent).replaceAll('\n', newline) + newline
      );
      runCLI('skills-auto-install', 'off');
      config.ax.skills.autoInstall = false;
      const saved =
        JSON.stringify(config, null, indent).replaceAll('\n', newline) +
        newline;
      expect(readFileSync(manifest, 'utf8')).toBe(saved);
      runCLI('skills-auto-install', 'off');
      expect(readFileSync(manifest, 'utf8')).toBe(saved);
    }
  );

  it.each([[], ['yes'], ['off', 'extra'], ['on', '--force']])(
    'rejects invalid arguments %j without changing the project',
    (...args) => {
      const manifest = path.join(project, 'package.json');
      const original = readFileSync(manifest, 'utf8');
      expect(() => runCLI('skills-auto-install', ...args)).toThrow();
      expect(readFileSync(manifest, 'utf8')).toBe(original);
      expect(existsSync(path.join(project, '.claude'))).toBe(false);
    }
  );

  it('requires a project manifest rather than creating one or changing a parent', () => {
    const manifest = path.join(project, 'package.json');
    rmSync(manifest);
    const parent = path.join(root, 'package.json');
    writeFileSync(parent, '{"name":"parent"}\n');
    expect(() => runCLI('skills-auto-install', 'off')).toThrow('project root');
    expect(existsSync(manifest)).toBe(false);
    expect(readFileSync(parent, 'utf8')).toBe('{"name":"parent"}\n');
  });

  it.each([
    '{broken',
    'null',
    '[]',
    '{"ax":null}',
    '{"ax":"existing setting"}',
    '{"ax":{"skills":[]}}',
    '{"ax":{"skills":{"autoInstall":"false"}}}',
  ])(
    'preserves invalid configuration %s and skips automatic writes',
    (source) => {
      const manifest = path.join(project, 'package.json');
      writeFileSync(manifest, source);
      expect(() => runCLI('skills-auto-install', 'off')).toThrow();
      expect(readFileSync(manifest, 'utf8')).toBe(source);
      runAutomaticInstall();
      expect(existsSync(path.join(project, '.claude'))).toBe(false);
      expect(readFileSync(manifest, 'utf8')).toBe(source);
    }
  );
});

describe('published skill bundles', () => {
  it('publishes entry points as reproducible archives containing every guide', async () => {
    const catalogs = await readSkillMirrorSources(repo, [
      'typescript',
      'python',
      'java',
      'cpp',
      'go',
      'rust',
    ]);
    for (const [language, skills] of Object.entries(catalogs)) {
      for (const skill of skills)
        expect(skill.files['SKILL.md']).toBe(skill.content);
      const router = skills.find(
        (skill) =>
          skill.name ===
          (language === 'typescript' ? 'ax-llm' : `ax-${language}-llm`)
      );
      const artifact = skillArtifact(router);
      const entry = skillIndexEntry(router);
      expect(artifact.bytes[9]).toBe(255);
      expect(entry.type).toBe('archive');
      expect(entry.digest).toBe(sha256Digest(artifact.bytes));
      expect(
        artifact.bytes.equals(
          createSkillArchive(
            Object.fromEntries(Object.entries(router.files).reverse())
          )
        )
      ).toBe(true);
      const archive = path.join(root, `${language}.tar.gz`);
      writeFileSync(archive, artifact.bytes);
      const dest = path.join(root, language);
      mkdirSync(dest);
      execFileSync('tar', ['-xzf', archive, '-C', dest]);
      for (const [file, content] of Object.entries(router.files))
        expect(readFileSync(path.join(dest, file), 'utf8')).toBe(content);
      const body = readFileSync(path.join(dest, 'SKILL.md'), 'utf8');
      expect(body.split('\n').length).toBeLessThan(90);
      for (const file of Object.keys(router.files).filter((file) =>
        file.startsWith('references/')
      )) {
        expect(body).toContain(`](${file})`);
      }
      for (const match of body.matchAll(
        /\]\((references\/[^)#]+)(?:#[^)]*)?\)/g
      ))
        expect(existsSync(path.join(dest, match[1]))).toBe(true);
      expect(
        Object.keys(router.files).filter((file) => file.endsWith('SKILL.md'))
      ).toEqual(['SKILL.md']);
    }
  });
});
