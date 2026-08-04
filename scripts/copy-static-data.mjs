import { cpSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Copy every file/subdirectory under srcDir into destDir, creating destDir
 * (and any missing parents) if needed. Existing files in destDir with the
 * same relative path are overwritten.
 * @param {string} srcDir
 * @param {string} destDir
 */
export function copyStaticData(srcDir, destDir) {
  if (!existsSync(srcDir)) {
    throw new Error(`copyStaticData: source directory does not exist: ${srcDir}`);
  }
  cpSync(srcDir, destDir, { recursive: true });
}

if (import.meta.main) {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  copyStaticData(join(root, 'dashboard', 'data'), join(root, 'dist-dashboard', 'data'));
  console.log('Copied dashboard/data/ -> dist-dashboard/data/');
}
