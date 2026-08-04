import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyStaticData } from '../../../scripts/copy-static-data.mjs';

describe('copyStaticData', () => {
  let src;
  let dest;
  let tempRoots;

  beforeEach(() => {
    tempRoots = [];
    const srcRoot = mkdtempSync(join(tmpdir(), 'copy-static-data-src-'));
    const destRoot = mkdtempSync(join(tmpdir(), 'copy-static-data-dest-'));
    tempRoots.push(srcRoot, destRoot);
    src = srcRoot;
    dest = join(destRoot, 'nested', 'dist-dashboard-data');
  });

  afterEach(() => {
    for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
  });

  it('copies a flat file from src into a dest directory that does not exist yet', () => {
    writeFileSync(join(src, 'factoids-1000.json'), '[{"id":1}]');

    copyStaticData(src, dest);

    expect(existsSync(join(dest, 'factoids-1000.json'))).toBe(true);
    expect(readFileSync(join(dest, 'factoids-1000.json'), 'utf-8')).toBe('[{"id":1}]');
  });

  it('copies nested subdirectories', () => {
    mkdirSync(join(src, 'sub'));
    writeFileSync(join(src, 'sub', 'nested.json'), '{}');

    copyStaticData(src, dest);

    expect(existsSync(join(dest, 'sub', 'nested.json'))).toBe(true);
  });

  it('throws if the source directory does not exist', () => {
    rmSync(src, { recursive: true, force: true });
    expect(() => copyStaticData(src, dest)).toThrow();
  });
});
