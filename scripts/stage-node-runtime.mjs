import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeDir = path.join(root, 'apps', 'desktop', 'runtime');
const nodeName = process.platform === 'win32' ? 'node.exe' : 'node';
const nodePath = path.join(runtimeDir, nodeName);
const licensePaths = [
  path.join(path.dirname(process.execPath), 'LICENSE'),
  path.resolve(path.dirname(process.execPath), '..', 'LICENSE'),
  path.resolve(path.dirname(process.execPath), '..', '..', 'LICENSE'),
];
const licensePath = licensePaths.find((candidate) => fs.existsSync(candidate));

const licenseText = licensePath
  ? fs.readFileSync(licensePath, 'utf8')
  : await (async () => {
    const response = await fetch(`https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Could not fetch the Node.js license: HTTP ${response.status}`);
    return response.text();
  })();

fs.rmSync(runtimeDir, { recursive: true, force: true });
fs.mkdirSync(runtimeDir, { recursive: true });
fs.copyFileSync(process.execPath, nodePath);
if (process.platform !== 'win32') fs.chmodSync(nodePath, 0o755);
fs.writeFileSync(path.join(runtimeDir, 'NODE-LICENSE.txt'), licenseText);

console.log(`Staged Node.js ${process.version} for ${process.platform}-${process.arch}`);
