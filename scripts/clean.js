import path  from 'path';
import process from 'process';

import fs from 'fs-extra';

process.argv.slice(1).map((fpath) => {
  const packagePath = process.cwd();
  const targetPath = path.join(packagePath, fpath);
  if (fs.existsSync(targetPath)) {
    console.log(`Cleaning folder ${targetPath}`);
    fs.rmdirSync(targetPath, { recursive: true });
  }
});

process.exit(0);
