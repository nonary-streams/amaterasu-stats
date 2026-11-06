import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc'], {stdio:'inherit'});
if (result.status !== 0) process.exit(result.status ?? 1);
await mkdir('dist', {recursive:true});
// Keep the compatibility namespace private to this signed plugin bundle.
await writeFile('dist/stats.js', '(function(){\n'+await readFile('build/stats.js','utf8')+'\n})();\n');
await copyFile('stats.css','dist/stats.css');
