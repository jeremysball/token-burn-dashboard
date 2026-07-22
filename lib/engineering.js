/**
 * Engineering ROI helpers - file ref extraction and git shortstat parsing.
 *
 * These are pure, side-effect-free helpers used to build heuristic
 * engineering-efficiency KPIs. No shell execution happens here.
 */

const EXTENSIONS = [
  '.js', '.ts', '.py', '.go', '.rs', '.java', '.rb',
  '.css', '.html', '.json', '.md'
];

/**
 * Extract workspace file references from free text.
 *
 * A path is kept only when it satisfies ALL of:
 *   1. Boundary check: it is not embedded in a URL. A token like
 *      `https://example.com/workspace/app/main.js` must be rejected even though
 *      `/workspace/app/main.js` appears as a substring, and a bare absolute path
 *      such as `/usr/bin` must not be surfaced.
 *   2. Location allowlist: it starts with /workspace/ (and stays within it after
 *      resolving `..` segments) or is a ./ or ../ relative path. Absolute paths
 *      outside /workspace/ (e.g. /home/..., /usr/...) are excluded to avoid
 *      leaking arbitrary filesystem locations. Traversal paths that escape
 *      /workspace/ (e.g. /workspace/../outside/secret.js) are normalized and
 *      rejected.
 *   3. Extension allowlist: it ends in a known source extension (EXTENSIONS).
 *      This rejects paths such as ./secret.txt or /workspace/x.env.
 *
 * Returns unique matches, capped at 20, with length bounds to avoid absurd
 * values.
 *
 * @param {string} text
 * @returns {string[]}
 */
function extractFileRefs(text) {
  if (!text) return [];
  if (typeof text !== 'string') return [];

  // Pull candidate tokens: a /workspace/... path, or a ./../ relative path with
  // an extension. The leading-context group captures the character(s) immediately
  // before the path so we can detect URL context (a path that was really part of
  // "https://host/workspace/..." rather than a real workspace reference).
  const re = /(^|[\s(])(?:\.{0,2}\/[\w/.-]+\.\w+|\/workspace\/[\w/.-]+)/g;
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

    // 2b. Location allowlist: workspace or relative.
    const isWorkspace = p.startsWith('/workspace/');
    const isRelative = /^(?:\.\.\/|\.\/)/.test(p);
    if (!(isWorkspace || isRelative)) continue;

    // 2c. Reject traversal paths that escape the allowed root. Normalize `..`
    //     segments and confirm the resolved path stays under /workspace/.
    if (p.includes('..')) {
      const allowed = normalizeWithinWorkspace(p);
      if (!allowed) continue;
    }

    if (p.length > 5 && p.length < 200) {
      matches.push(p);
    }
  }
  return [...new Set(matches)].slice(0, 20);
}

/**
 * Normalize a candidate path and confirm it resolves to a location we allow.
 *
 * - /workspace/... paths must resolve (after collapsing `..`) to somewhere still
 *   rooted at /workspace/; otherwise (e.g. /workspace/../outside/secret.js) the
 *   path escapes the allowed root and is rejected.
 * - Relative ./../ paths are permitted as-is (they are relative to the working
 *   directory and cannot name an absolute location), provided they do not start
 *   with /workspace/ after normalization.
 *
 * @param {string} p
 * @returns {boolean} true if the path is allowed after normalization
 */
function normalizeWithinWorkspace(p) {
  if (p.startsWith('/workspace/')) {
    const parts = p.split('/');
    const stack = [];
    for (const part of parts) {
      if (part === '' || part === '.') continue;
      if (part === '..') {
        if (stack.length === 0) return false;
        stack.pop();
      } else {
        stack.push(part);
      }
    }
    // Must still be rooted at /workspace/ after resolving `..`.
    return stack[0] === 'workspace';
  }
  // Relative paths: allowed (cannot name an absolute location).
  return true;
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
