import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Node 20.12+ refuses to spawn npm.cmd without a shell (CVE-2024-27980), and a
// shell would break the no-injection guarantee, so the npm tools refuse on Windows.
export function windowsRefusal(toolName) {
  return process.platform === 'win32' ? `${toolName} is not supported on Windows in v1.` : null;
}

// → { pkg } or { message } for the "no npm project here" conditions.
export async function readPackageJson(cwd, toolName) {
  let text;
  try {
    text = await readFile(join(cwd, 'package.json'), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { message: `No package.json in ${cwd}; ${toolName} needs an npm project.` };
    throw err;
  }
  try {
    return { pkg: JSON.parse(text) };
  } catch (err) {
    return { message: `package.json could not be parsed: ${err.message}` };
  }
}
