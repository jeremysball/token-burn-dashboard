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

    afterEach(() => {
        if (origEnv === undefined) delete process.env.EXTRA_SESSION_DIRS;
        else process.env.EXTRA_SESSION_DIRS = origEnv;
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

        process.env.EXTRA_SESSION_DIRS = tmpDir;
        jest.resetModules();
        const { runTokenBurn } = require('../../../lib/token-burn');
        const result = await runTokenBurn();

        expect(result.tokens_by_model).toHaveProperty('test/extra-model-abc');
        expect(result.tokens_by_model['test/extra-model-abc'].total).toBe(15);

        fs.rmSync(tmpDir, { recursive: true, force: true });
    });
});
