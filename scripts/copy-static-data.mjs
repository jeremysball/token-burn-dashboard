import { cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Copy every file/subdirectory under srcDir into destDir, creating destDir
 * (and any missing parents) if needed. Existing files in destDir with the
 * same relative path are overwritten. Throws (via cpSync's own ENOENT) if
 * srcDir does not exist.
 * @param {string} srcDir
 * @param {string} destDir
 */
export function copyStaticData(srcDir, destDir) {
  cpSync(srcDir, destDir, { recursive: true });
}

if (import.meta.main) {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  copyStaticData(join(root, 'dashboard', 'data'), join(root, 'dist-dashboard', 'data'));
  console.log('Copied dashboard/data/ -> dist-dashboard/data/');
}
