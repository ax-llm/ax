import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readProjectConfig(projectRoot) {
  const file = join(projectRoot, 'package.json');
  const source = readFileSync(file, 'utf8');
  const config = JSON.parse(source);
  if (
    !isObject(config) ||
    ('ax' in config && !isObject(config.ax)) ||
    (config.ax && 'skills' in config.ax && !isObject(config.ax.skills)) ||
    (config.ax?.skills &&
      'autoInstall' in config.ax.skills &&
      typeof config.ax.skills.autoInstall !== 'boolean')
  )
    throw new Error(
      'Expected package.json ax.skills.autoInstall to be a boolean within ax and skills objects.'
    );
  return { file, source, config };
}

export function autoSkillInstallEnabled(projectRoot) {
  try {
    return (
      readProjectConfig(projectRoot).config.ax?.skills?.autoInstall !== false
    );
  } catch (error) {
    if (error.code === 'ENOENT') return true;
    throw error;
  }
}

export function setAutoSkillInstall(projectRoot, enabled) {
  let project;
  try {
    project = readProjectConfig(projectRoot);
  } catch (error) {
    if (error.code === 'ENOENT')
      throw new Error(
        'No package.json found. Run this command from your project root.'
      );
    throw error;
  }
  const { file, source, config } = project;
  config.ax ??= {};
  config.ax.skills ??= {};
  config.ax.skills.autoInstall = enabled;
  const indent = source.match(/^[\t ]+(?=")/m)?.[0] ?? 2;
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const content = JSON.stringify(config, null, indent).replaceAll(
    '\n',
    newline
  );
  writeFileSync(file, content + (source.endsWith('\n') ? newline : ''), 'utf8');
}
