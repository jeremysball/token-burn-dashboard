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
});
