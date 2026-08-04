// dashboard/js/equiv-format.js

const EXPR_ALLOWED = /^[0-9n.*/+\-() ]+$/;
/** @type {Map<string, Function>} */
const compiledExprCache = new Map();
/** @type {Map<number, Intl.NumberFormat>} */
const fixedDigitsFormatterCache = new Map();
const intFormatter = new Intl.NumberFormat('en-US');

/**
 * @param {string} expr
 * @returns {Function}
 */
function compileExpr(expr) {
    let fn = compiledExprCache.get(expr);
    if (fn === undefined) {
        fn = Function('n', '"use strict"; return (' + expr + ');');
        compiledExprCache.set(expr, fn);
    }
    return fn;
}

/**
 * @param {number} digits
 * @returns {Intl.NumberFormat}
 */
function fixedDigitsFormatter(digits) {
    let fmt = fixedDigitsFormatterCache.get(digits);
    if (fmt === undefined) {
        fmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
        fixedDigitsFormatterCache.set(digits, fmt);
    }
    return fmt;
}

/**
 * Evaluate a factoid's `copy` string against a live numeric value, replacing
 * every `{expr}` or `{expr:.Nf}` placeholder with the computed, formatted
 * result. `n` inside `expr` refers to the live numeric value, passed to the
 * compiled expression as a real function argument (never stringified into
 * source text, so `n`'s own textual form — e.g. exponential notation for a
 * very large/small value — can never affect what characters `expr` itself
 * contains). Any placeholder whose expression contains a character outside
 * the allowed character set (digits, `n`, `.`, `*`, `/`, `+`, `-`, parens,
 * space), or that fails to evaluate to a finite number, is left untouched in
 * the output rather than throwing or executing arbitrary code — this is the
 * corpus's only trust boundary, since factoid `copy` strings are data, not
 * code the app authored.
 * @param {string} copyTemplate
 * @param {number} n
 * @returns {string}
 */
export function formatFactoid(copyTemplate, n) {
    return copyTemplate.replace(/\{([^}]{1,200})\}/g, (whole, inner) => {
        const parts = inner.split(':.');
        if (parts.length > 2) return whole;
        const expr = parts[0];
        if (!EXPR_ALLOWED.test(expr)) return whole;

        let value;
        try {
            value = compileExpr(expr)(n);
        } catch (err) {
            console.warn('formatFactoid: expression evaluation failed, leaving placeholder untouched', { expr, err });
            return whole;
        }
        if (typeof value !== 'number' || !Number.isFinite(value)) return whole;

        if (parts.length > 1) {
            const digitsSpec = parts[1].match(/^(\d{1,3})f$/);
            if (!digitsSpec || Number(digitsSpec[1]) > 100) return whole;
            return fixedDigitsFormatter(Number(digitsSpec[1])).format(value);
        }
        return intFormatter.format(Math.round(value));
    });
}
