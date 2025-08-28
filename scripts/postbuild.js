import { readFile, writeFile } from 'node:fs/promises';
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

// Write the modified package.json to the build folder
await writeFile(
  path.resolve(buildPath, './package.json'),
  JSON.stringify(packageJson, null, 2)
);

console.log('package.json has been modified and copied to the build folder.');
