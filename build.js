import fs from 'fs';
import path from 'path';

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

console.log('\n✅ Build complete!');
console.log(`   Files in ${DIST_DIR}/`);
console.log('   - mono-dashboard.css');
console.log('   - mono-dashboard.js');
console.log('   - themes/');
