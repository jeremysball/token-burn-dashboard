/**
 * Engineering ROI helpers - file ref extraction and git shortstat parsing.
 *
 * These are pure, side-effect-free helpers used to build heuristic
 * engineering-efficiency KPIs. No shell execution happens here.
 */

const { PROJECT_ROOT } = require('./config');
const { isPathWithinRoot } = require('./security');

const EXTENSIONS = [
  '.js', '.ts', '.py', '.go', '.rs', '.java', '.rb',
  '.css', '.html', '.json', '.md'
];

/**
 * Escape a string for literal use inside a RegExp.
 * @param {string} s
 * @returns {string}
 */
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Extract workspace file references from free text.
 *
 * A path is kept only when it satisfies ALL of:
 *   1. Boundary check: it is not embedded in a URL. A token like
 *      `https://example.com/workspace/app/main.js` must be rejected even though
 *      `/workspace/app/main.js` appears as a substring, and a bare absolute path
 *      such as `/usr/bin` must not be surfaced.
 *   2. Location allowlist: it starts with `root` (and stays within it after
 *      resolving `..` segments) or is a ./ or ../ relative path. Absolute paths
 *      outside `root` (e.g. /usr/...) are excluded to avoid leaking arbitrary
 *      filesystem locations. Traversal paths that escape `root`
 *      (e.g. <root>/../outside/secret.js) are normalized and rejected.
 *   3. Extension allowlist: it ends in a known source extension (EXTENSIONS).
 *      This rejects paths such as ./secret.txt or <root>/x.env.
 *
 * `root` defaults to config.PROJECT_ROOT (DASHBOARD_PROJECT_ROOT, else $HOME,
 * else cwd). It used to be the literal string '/workspace/', which meant the
 * function returned nothing at all on any checkout laid out differently, and
 * anchored the traversal guard to a directory unrelated to the real project.
 *
 * Returns unique matches, capped at 20, with length bounds to avoid absurd
 * values.
 *
 * @param {string} text
 * @param {string} [root] absolute directory that absolute refs must stay inside
 * @returns {string[]}
 */
function extractFileRefs(text, root = PROJECT_ROOT) {
  if (!text) return [];
  if (typeof text !== 'string') return [];
  if (!root || typeof root !== 'string') return [];

  // Normalize away a trailing separator so `${root}/` below never doubles it.
  const base = root.endsWith('/') ? root.slice(0, -1) : root;

  // Pull candidate tokens: a <root>/... path, or a ./../ relative path with
  // an extension. The leading-context group captures the character(s) immediately
  // before the path so we can detect URL context (a path that was really part of
  // "https://host<root>/..." rather than a real project reference).
  const re = new RegExp(
    `(^|[\\s(])(?:\\.{0,2}\\/[\\w/.-]+\\.\\w+|${escapeRegExp(base)}\\/[\\w/.-]+)`,
    'g'
  );
  const matches = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const p = m[0].replace(/^[\s(]+/, '');

    // 1. Reject anything preceded by URL scheme/host context. We look backwards
    //    from the match start: if the preceding run of non-space chars contains
    //    "://", this token is part of a URL (e.g. the /workspace/ segment of
    //    https://example.com/workspace/app/main.js) and must be ignored.
    const before = text.slice(0, m.index);
    if (/\/\/[^\s/]*$/.test(before) || /https?:\/\/[^\s]*$/.test(before)) continue;

    // 2a. Extension allowlist: must end in a known source extension.
    const hasAllowedExt = EXTENSIONS.some(e => p.toLowerCase().endsWith(e));
    if (!hasAllowedExt) continue;

    // 2b. Location allowlist: under the project root, or relative.
    const isUnderRoot = p.startsWith(`${base}/`);
    const isRelative = /^(?:\.\.\/|\.\/)/.test(p);
    if (!(isUnderRoot || isRelative)) continue;

    // 2c. Reject traversal paths that escape the allowed root. isPathWithinRoot
    //     resolves `..` segments and confirms containment. Relative paths are
    //     exempt: they cannot name an absolute location, and callers rely on
    //     ../src/util.ts being kept.
    if (isUnderRoot && p.includes('..') && !isPathWithinRoot(p, base)) continue;

    if (p.length > 5 && p.length < 200) {
      matches.push(p);
    }
  }
  return [...new Set(matches)].slice(0, 20);
}

/**
 * Map a file path to a language label based on its extension.
 * Returns 'unknown' when the extension is unrecognized.
 *
 * @param {string} filePath
 * @returns {string}
 */
function getFileExtensionLang(filePath) {
  if (!filePath || typeof filePath !== 'string') return 'unknown';
  const dot = filePath.lastIndexOf('.');
  if (dot < 0) return 'unknown';
  const ext = filePath.slice(dot).toLowerCase();
  /** @type {Record<string, string>} */
  const map = {
    '.js': 'JavaScript',
    '.ts': 'TypeScript',
    '.py': 'Python',
    '.go': 'Go',
    '.rs': 'Rust',
    '.java': 'Java',
    '.rb': 'Ruby',
    '.css': 'CSS',
    '.html': 'HTML',
    '.json': 'JSON',
    '.md': 'Markdown'
  };
  return map[ext] || 'unknown';
}

/**
 * Parse `git show --shortstat` output into numeric counts.
 *
 * Example input:
 *   " 3 files changed, 120 insertions(+), 14 deletions(-)"
 *
 * Returns zeroed counts when the input is missing or unparseable so callers
 * can avoid divide-by-zero.
 *
 * @param {string} text
 * @returns {{filesChanged:number, insertions:number, deletions:number, loc:number}}
 */
function parseShortStat(text) {
  const zero = { filesChanged: 0, insertions: 0, deletions: 0, loc: 0 };
  if (!text || typeof text !== 'string') return zero;

  const files = /(\d+)\s+files?\s+changed/i.exec(text);
  const ins = /(\d+)\s+insertions?\(\+\)/i.exec(text);
  const del = /(\d+)\s+deletions?\(-\)/i.exec(text);

  const filesChanged = files ? parseInt(files[1], 10) : 0;
  const insertions = ins ? parseInt(ins[1], 10) : 0;
  const deletions = del ? parseInt(del[1], 10) : 0;

  return {
    filesChanged,
    insertions,
    deletions,
    loc: insertions + deletions
  };
}

module.exports = {
  EXTENSIONS,
  extractFileRefs,
  getFileExtensionLang,
  parseShortStat
};
