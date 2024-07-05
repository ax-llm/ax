import path from 'path';

import fs from 'fs-extra';

// eslint-disable-next-line no-undef
const packagePath = process.cwd();
const buildPath = path.join(packagePath, './build');

const packageJsonData = await fs.readFile(path.resolve(packagePath, './package.json'), 'utf8');
const packageJson = JSON.parse(packageJsonData);

// Modify the package.json object
packageJson.main = 'index.js';
packageJson.module = 'cjs/index.js';
packageJson.types = 'index.d.ts';
packageJson.exports = {
  '.': {
    import: './index.js',
    require: './cjs/index.js'
  },
  './*.js': {
    import: './*.js',
    require: './cjs/*.js'
  },
  './*': {
    import: './*.js',
    require: './cjs/*.js'
  }
};

// Remove devDependencies
delete packageJson.devDependencies;
delete packageJson.scripts;

// Write the modified package.json to the build folder
fs.writeJsonSync(path.resolve(buildPath, './package.json'), packageJson, { spaces: 2 });
fs.writeJsonSync(path.resolve(path.join(buildPath, 'cjs'), './package.json'), { "type": "commonjs" }, { spaces: 2 });

console.log('package.json has been modified and copied to the build folder.');
