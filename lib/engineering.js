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
 * A path is kept only when it satisfies BOTH:
 *   1. Location allowlist: it starts with /workspace/ or is a ./ or ../ relative
 *      path (absolute paths outside /workspace/ like /home/..., /usr/... are
 *      excluded to avoid leaking arbitrary filesystem locations).
 *   2. Extension allowlist: it ends in a known source extension (EXTENSIONS).
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

  // Match either a /workspace/... path, or a ./../ relative path with an
  // extension. Extension is validated against the allowlist below.
  const re = /(?:\/workspace\/[\w/.-]+|(?:^|[\s(])\.{0,2}\/[\w/.-]+\.\w+)/g;
  const matches = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const p = m[0].replace(/^[\s(]+/, '');
    // Location allowlist: workspace paths, or relative ./../ paths.
    const isWorkspace = p.startsWith('/workspace/');
    const isRelative = /^(?:\.\.\/|\.\/)/.test(p);
    // Extension allowlist: must end in a known source extension.
    const hasAllowedExt = EXTENSIONS.some(e => p.toLowerCase().endsWith(e));
    if ((isWorkspace || isRelative) && hasAllowedExt && p.length > 5 && p.length < 200) {
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
