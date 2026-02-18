import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const packagePath = process.cwd();
const buildPath = path.join(packagePath, './dist');

const packageJsonData = await readFile(
  path.resolve(packagePath, './package.json'),
  'utf8'
);
const packageJson = JSON.parse(packageJsonData);

// "main": "./index.cjs",
// "module": "./index.js",
// "types": "./index.d.ts",
// "browser": "./index.global.js",
// "exports": {
//   ".": {
//     "types": "./index.d.ts",
//     "browser": "./index.global.js",
//     "import": "./index.js",
//     "require": "./index.cjs"
//   }
// },

// Modify the package.json object
packageJson.main = './index.cjs';
packageJson.module = './index.js';
packageJson.types = './index.d.ts';
packageJson.exports = {
  '.': {
    types: './index.d.ts',
    import: './index.js',
    require: './index.cjs',
  },
  './index.global.js': './index.global.js',
  './*': {
    types: './*.d.ts',
    import: './*.js',
    require: './*.cjs',
  },
};

// Remove devDependencies and scripts
delete packageJson.devDependencies;
delete packageJson.scripts;

// Conditionally add bin entry for CLI (only if cli/ directory exists)
const cliSourcePath = path.join(packagePath, 'cli');
if (existsSync(cliSourcePath)) {
  packageJson.bin = {
    ax: './cli/index.mjs',
  };
}

// Conditionally add postinstall script (only if scripts/ directory exists)
const scriptsSourcePath = path.join(packagePath, 'scripts');
if (existsSync(scriptsSourcePath)) {
  packageJson.scripts = {
    postinstall: 'node ./scripts/postinstall.mjs',
  };
}

// Write the modified package.json to the build folder
await writeFile(
  path.resolve(buildPath, './package.json'),
  JSON.stringify(packageJson, null, 2)
);

console.log('package.json has been modified and copied to the build folder.');

// Copy skills directory with version injection
const skillsSourcePath = path.join(packagePath, 'skills');
const skillsDestPath = path.join(buildPath, 'skills');

if (existsSync(skillsSourcePath)) {
  await mkdir(skillsDestPath, { recursive: true });

  // Read all *.md skill files and inject version
  const files = await readdir(skillsSourcePath);
  const skillFiles = files.filter((f) => f.endsWith('.md'));

  for (const file of skillFiles) {
    const skillContent = await readFile(path.join(skillsSourcePath, file), 'utf8');
    const updatedSkillContent = skillContent.replace(
      /^version:\s*["']?__VERSION__["']?/m,
      `version: "${packageJson.version}"`
    );
    await writeFile(path.join(skillsDestPath, file), updatedSkillContent);
    console.log(`Skill file ${file} copied with version ${packageJson.version}`);
  }
}

// Copy CLI directory
const cliDestPath = path.join(buildPath, 'cli');

if (existsSync(cliSourcePath)) {
  await mkdir(cliDestPath, { recursive: true });
  const cliFilePath = path.join(cliSourcePath, 'index.mjs');
  if (existsSync(cliFilePath)) {
    await copyFile(cliFilePath, path.join(cliDestPath, 'index.mjs'));
    console.log('CLI copied to dist/cli/');
  }
}

// Copy scripts directory
const scriptsDestPath = path.join(buildPath, 'scripts');

if (existsSync(scriptsSourcePath)) {
  await mkdir(scriptsDestPath, { recursive: true });
  const postinstallPath = path.join(scriptsSourcePath, 'postinstall.mjs');
  if (existsSync(postinstallPath)) {
    await copyFile(postinstallPath, path.join(scriptsDestPath, 'postinstall.mjs'));
    console.log('Postinstall script copied to dist/scripts/');
  }
}
