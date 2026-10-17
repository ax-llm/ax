#!/usr/bin/env node

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setAutoSkillInstall } from '../scripts/skill-config.mjs';
import { installSkills, removeSkills } from '../scripts/skill-install.mjs';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const [command = 'help', ...flags] = process.argv.slice(2);

function showHelp() {
  console.log(`
@ax-llm/ax CLI

Usage:
  npx @ax-llm/ax <command> [options]

Commands:
  setup-claude             Install the Ax entry point and bundled guides locally
  remove-claude            Remove installed Ax skills and their bundled guides
  skills-auto-install <on|off>
                          Save automatic setup preference in project package.json
  help                     Show this help

Options for setup-claude:
  --all                    Install every specialist as a separate skill too
  --skill <name>           Install only the named skill (repeatable)
  --force                  Reinstall even if the installed version is newer

Examples:
  npx @ax-llm/ax setup-claude
  npx @ax-llm/ax setup-claude --all
  npx @ax-llm/ax setup-claude --skill ax-ai
  npx @ax-llm/ax skills-auto-install off
  npx @ax-llm/ax skills-auto-install on

Automatic setup installs only ax-llm in .claude/skills, outside CI.
Run skills-auto-install off from your project root to disable future automatic setup.
This saves ax.skills.autoInstall in package.json; on restores automatic setup.
Manual setup-claude still works while automatic setup is disabled.
Set AX_SKIP_SKILL_INSTALL=1 to skip setup for a single package installation.
Existing specialist installs remain until you run remove-claude.
`);
}

try {
  if (command === 'setup-claude') {
    const options = { all: false, force: false, names: [] };
    for (let i = 0; i < flags.length; i++) {
      const flag = flags[i];
      if (flag === '--all') options.all = true;
      else if (flag === '--force') options.force = true;
      else if (
        flag === '--skill' &&
        flags[i + 1] &&
        !flags[i + 1].startsWith('--')
      )
        options.names.push(flags[++i]);
      else throw new Error(`Unknown or incomplete option: ${flag}`);
    }
    if (options.all && options.names.length)
      throw new Error('Choose --all or --skill.');
    const installed = installSkills(packageRoot, process.cwd(), options);
    console.log(
      installed.length
        ? `✓ Installed Ax skills: ${installed.join(', ')}`
        : 'Ax skills are up to date.'
    );
  } else if (command === 'remove-claude' && flags.length === 0) {
    console.log(
      `✓ Removed ${removeSkills(packageRoot, process.cwd())} Ax skills.`
    );
  } else if (command === 'skills-auto-install') {
    if (flags.length !== 1 || !['on', 'off'].includes(flags[0]))
      throw new Error('Usage: npx @ax-llm/ax skills-auto-install <on|off>');
    const enabled = flags[0] === 'on';
    setAutoSkillInstall(process.cwd(), enabled);
    console.log(
      `✓ Automatic Ax skill installation ${enabled ? 'enabled' : 'disabled'} in package.json.`
    );
  } else if (['help', '--help', '-h'].includes(command)) {
    showHelp();
  } else {
    throw new Error(
      `Unknown command: ${command}. Run npx @ax-llm/ax help for usage.`
    );
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
