/**
 * Tests for token-burn parseJsonlFile: explicit totalTokens:0 preservation
 * and reasoning inclusion in computed totals.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseJsonlFile } = require('../../../lib/token-burn');

const writeTemp = (lines) => {
    const file = path.join(os.tmpdir(), `tb-test-${Date.now()}-${Math.random()}.jsonl`);
    fs.writeFileSync(file, lines.join('\n'));
    return file;
};

import { afterEach, describe, expect, it } from 'bun:test';

describe('parseJsonlFile totalTokens handling', () => {
    it('preserves an explicit totalTokens of 0 (not truthy fallback)', () => {
        const file = writeTemp([
            JSON.stringify({
                type: 'message',
                message: {
                    model: 'm',
                    provider: 'p',
                    usage: { input: 1, output: 1, reasoning: 5, totalTokens: 0 }
                }
            })
        ]);
        const result = parseJsonlFile(file);
        expect(result.total_tokens).toBe(0);
        expect(result.total_reasoning).toBe(5);
        fs.unlinkSync(file);
    });

    it('computes the total from components when totalTokens absent', () => {
        const file = writeTemp([
            JSON.stringify({
                type: 'message',
                message: {
                    model: 'm',
                    provider: 'p',
                    usage: { input: 1, output: 1, reasoning: 5 }
                }
            })
        ]);
        const result = parseJsonlFile(file);
        expect(result.total_tokens).toBe(7);
        expect(result.total_reasoning).toBe(5);
        fs.unlinkSync(file);
    });

    it('skips malformed lines without throwing (parser safety)', () => {
        const file = writeTemp([
            JSON.stringify({
                type: 'message',
                message: {
                    model: 'm',
                    provider: 'p',
                    usage: { input: 1, output: 1, totalTokens: 2 }
                }
            }),
            'not valid json',
            '{ incomplete'
        ]);
        const result = parseJsonlFile(file);
        expect(result.total_tokens).toBe(2);
        expect(result.messages).toBe(1);
        fs.unlinkSync(file);
    });
});

describe('runTokenBurn API wiring', () => {
    const origEnv = process.env.EXTRA_SESSION_DIRS;
    const origClaudeProjectsDir = process.env.CLAUDE_PROJECTS_DIR;
    const origPiSessionDirs = process.env.PI_SESSION_DIRS;

    afterEach(() => {
        if (origEnv === undefined) delete process.env.EXTRA_SESSION_DIRS;
        else process.env.EXTRA_SESSION_DIRS = origEnv;
        if (origClaudeProjectsDir === undefined) delete process.env.CLAUDE_PROJECTS_DIR;
        else process.env.CLAUDE_PROJECTS_DIR = origClaudeProjectsDir;
        if (origPiSessionDirs === undefined) delete process.env.PI_SESSION_DIRS;
        else process.env.PI_SESSION_DIRS = origPiSessionDirs;
    });

    it('honors EXTRA_SESSION_DIRS by including sessions from the configured directory', async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-extra-'));
        const file = writeTemp([
            JSON.stringify({
                type: 'message',
                message: {
                    model: 'extra-model-abc',
                    provider: 'test',
                    usage: { input: 10, output: 5, totalTokens: 15 }
                }
            })
        ]);
        fs.renameSync(file, path.join(tmpDir, 'extra.jsonl'));

        // Every discovery root other than EXTRA_SESSION_DIRS points at an
        // empty directory, so the fixture can only be found via the variable
        // under test. Pointing them at tmpDir instead would make this pass
        // even if EXTRA_SESSION_DIRS were ignored entirely.
        //
        // PI_SESSION_DIRS in particular has to be set: the Pi bases otherwise
        // resolve against the real os.homedir(), so the scan walks every
        // ~/.pi session on the dev's machine and blows the 5s timeout. CI only
        // passed because $HOME/.pi doesn't exist there. (Bun's os.homedir()
        // reads passwd, not $HOME, so overriding HOME does not isolate this.)
        const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-empty-'));
        process.env.EXTRA_SESSION_DIRS = tmpDir;
        process.env.CLAUDE_PROJECTS_DIR = emptyDir;
        process.env.PI_SESSION_DIRS = emptyDir;
        delete require.cache[require.resolve('../../../lib/session-discovery')];
        delete require.cache[require.resolve('../../../lib/token-burn')];
        const { runTokenBurn } = require('../../../lib/token-burn');
        const result = await runTokenBurn();

        expect(result.tokens_by_model).toHaveProperty('test/extra-model-abc');
        expect(result.tokens_by_model['test/extra-model-abc'].total).toBe(15);

        fs.rmSync(tmpDir, { recursive: true, force: true });
        fs.rmSync(emptyDir, { recursive: true, force: true });
    });
});
