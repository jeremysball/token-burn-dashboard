const fs = require('fs');
const path = require('path');

const SRC_DIR = './src';
const DIST_DIR = './dist';

// Ensure dist directory exists
if (!fs.existsSync(DIST_DIR)) {
  fs.mkdirSync(DIST_DIR, { recursive: true });
}

// Copy CSS
const cssSource = fs.readFileSync(path.join(SRC_DIR, 'mono-dashboard.css'), 'utf8');
fs.writeFileSync(path.join(DIST_DIR, 'mono-dashboard.css'), cssSource);
console.log('✓ Built mono-dashboard.css');

// Create bundled JS
const jsFiles = [
  'utils/formatters.js',
  'utils/dom.js',
  'components/StatBlock.js',
  'components/ProgressBar.js',
  'components/DataTable.js',
  'components/DetailPanel.js',
  'MonoDashboard.js'
];

let bundledJS = '';
bundledJS += `// Mono Dashboard v0.1.0\n`;
bundledJS += `// Bundled: ${new Date().toISOString()}\n\n`;

// Read and bundle all JS files
jsFiles.forEach(file => {
  const content = fs.readFileSync(path.join(SRC_DIR, file), 'utf8');
  bundledJS += `// --- ${file} ---\n`;
  bundledJS += content.replace(/import\s+.*?\s+from\s+['"][^'"]+['"];?\n?/g, '');
  bundledJS += '\n\n';
});

// Add export
bundledJS += `export { MonoDashboard };\n`;

fs.writeFileSync(path.join(DIST_DIR, 'mono-dashboard.js'), bundledJS);
console.log('✓ Built mono-dashboard.js');

// Copy themes
const themesDir = path.join(SRC_DIR, 'themes');
const themesDist = path.join(DIST_DIR, 'themes');
if (!fs.existsSync(themesDist)) {
  fs.mkdirSync(themesDist, { recursive: true });
}

fs.readdirSync(themesDir).forEach(file => {
  fs.copyFileSync(path.join(themesDir, file), path.join(themesDist, file));
  console.log(`✓ Copied theme: ${file}`);
});

// Generate a V3 source map for the bundled JS, mapping each `// --- file ---`
// section back to its original file in src/. Bundling above strips import
// statements, so line numbers drift between src and dist — the map below
// tracks that per-section offset rather than assuming a 1:1 line mapping.
generateSourceMap();

console.log('\n✅ Build complete!');
console.log(`   Files in ${DIST_DIR}/`);
console.log('   - mono-dashboard.css');
console.log('   - mono-dashboard.js');
console.log('   - mono-dashboard.js.map');
console.log('   - themes/');

function generateSourceMap() {
  const OUT = path.join(DIST_DIR, 'mono-dashboard.js.map');
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function vlq(n) {
    let v = n < 0 ? ((-n) << 1) | 1 : n << 1;
    let s = '';
    while (v >= 32) { s += B64[(v & 31) | 32]; v >>= 5; }
    return s + B64[v];
  }

  const lines = bundledJS.split('\n');

  // Parse sections from // --- markers ---
  const sections = [];
  let cur = null;
  lines.forEach((l, i) => {
    const m = l.match(/^\/\/ --- (.+) ---$/);
    if (m) {
      if (cur) cur[2] = i - 1;
      cur = [m[1], i + 2, null];
      sections.push(cur);
    }
  });
  if (cur) cur[2] = lines.length;
  let lastSec = sections[sections.length - 1];
  while (lastSec[2] > lastSec[1] && lines[lastSec[2] - 1].trim() === '') lastSec[2]--;
  if (lines[lastSec[2] - 1].startsWith('export {')) lastSec[2]--;

  const IMPT_RE = /import\s+.*?\s+from\s+['"][^'"]+['"];?\n?/;

  // For each source, build array of original line numbers after stripping imports
  const srcLineMap = sections.map(s => {
    const raw = fs.readFileSync(path.join(SRC_DIR, s[0]), 'utf-8').split('\n');
    const map = [];
    raw.forEach((rl, idx) => {
      if (!IMPT_RE.test(rl)) map.push(idx + 1);
    });
    return map;
  });

  const sources = sections.map(s => '../src/' + s[0]);
  const sourcesContent = sections.map(s => fs.readFileSync(path.join(SRC_DIR, s[0]), 'utf-8'));

  let rCol = 0, rSrc = 0, rLine = 0, rColSrc = 0;
  let m = '';

  for (let genLine = 0; genLine < lines.length; genLine++) {
    let srcIdx = -1, offset = -1;
    for (let si = 0; si < sections.length; si++) {
      const s = sections[si];
      if (genLine + 1 >= s[1] && genLine + 1 < s[2]) {
        srcIdx = si;
        offset = (genLine + 1) - s[1];
        break;
      }
    }
    if (genLine > 0) m += ';';
    if (srcIdx >= 0 && offset >= 0 && offset < srcLineMap[srcIdx].length) {
      const srcLine = srcLineMap[srcIdx][offset] - 1;
      m += vlq(0 - rCol) + vlq(srcIdx - rSrc) + vlq(srcLine - rLine) + vlq(0 - rColSrc);
      rCol = 0; rSrc = srcIdx; rLine = srcLine; rColSrc = 0;
    }
  }

  fs.writeFileSync(OUT, JSON.stringify({
    version: 3,
    file: 'mono-dashboard.js',
    sourceRoot: '',
    sources,
    sourcesContent,
    names: [],
    mappings: m
  }));

  const mLines = m.split(';').length;
  console.log(`✓ ${OUT} — ${sections.length} sections, ${lines.length} lines, ${mLines} mapping lines`);
}
