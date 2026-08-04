// dashboard/js/equiv-format.js
/**
 * Evaluate a factoid's `copy` string against a live numeric value, replacing
 * every `{expr}` or `{expr:.Nf}` placeholder with the computed, formatted
 * result. `n` inside `expr` is substituted with the literal numeric value
 * before evaluation. Any placeholder whose expression contains a character
 * outside the allowed character set (digits, `.`, `*`, `/`, `+`, `-`, parens,
 * space), or that fails to evaluate to a finite number, is
 * left untouched in the output rather than throwing or executing arbitrary
 * code — this is the corpus's only trust boundary, since factoid `copy`
 * strings are data, not code the app authored.
 * @param {string} copyTemplate
 * @param {number} n
 * @returns {string}
 */
export function formatFactoid(copyTemplate, n) {
    return copyTemplate.replace(/\{([^}]+)\}/g, (whole, inner) => {
        const parts = inner.split(':.');
        const expr = parts[0].replace(/n/g, String(n));
        if (!/^[0-9.*/+\-() ]+$/.test(expr)) return whole;

        let value;
        try {
            value = Function('"use strict"; return (' + expr + ');')();
        } catch {
            return whole;
        }
        if (typeof value !== 'number' || !Number.isFinite(value)) return whole;

        if (parts.length > 1) {
            const digitsSpec = parts[1].match(/^(\d{1,3})f$/);
            if (!digitsSpec || Number(digitsSpec[1]) > 100) return whole;
            const digits = Number(digitsSpec[1]);
            return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
        }
        return Math.round(value).toLocaleString('en-US');
    });
}
