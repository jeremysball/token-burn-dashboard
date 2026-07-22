const fs = require('fs');
const path = require('path');

// Decorative color emoji Fable flagged as breaking the mono system.
// Excludes plain-text status glyphs (already in the mono spirit) and the
// theme-toggle's plain-text moon/sun, which stay.
const DECORATIVE_EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]️?/gu;
const ALLOWED = new Set(['✓', '✗', '⚠', '↻', '☾', '☀']);

const readSource = (relPath) => fs.readFileSync(path.join(__dirname, '../../', relPath), 'utf8');

const expectNoDecorativeEmoji = (relPath) => {
  const content = readSource(relPath);
  const matches = (content.match(DECORATIVE_EMOJI) || []).filter((m) => !ALLOWED.has(m));
  expect(matches).toEqual([]);
};

describe('decorative emoji sweep', () => {
  it('dashboard/index.html has no decorative emoji', () => {
    expectNoDecorativeEmoji('dashboard/index.html');
  });

  it('dashboard/js/main.js has no decorative emoji', () => {
    expectNoDecorativeEmoji('dashboard/js/main.js');
  });

  it('dashboard/js/config.js has no decorative emoji', () => {
    expectNoDecorativeEmoji('dashboard/js/config.js');
  });

  it('dashboard/js/views/dashboard.js has no decorative emoji', () => {
    expectNoDecorativeEmoji('dashboard/js/views/dashboard.js');
  });

  it('dashboard/js/views/analytics.js has no decorative emoji', () => {
    expectNoDecorativeEmoji('dashboard/js/views/analytics.js');
  });

  const analyticsTabFiles = fs
    .readdirSync(path.join(__dirname, '../../dashboard/js/views/analytics/tabs'))
    .filter((f) => f.endsWith('.js'));

  analyticsTabFiles.forEach((file) => {
    it(`dashboard/js/views/analytics/tabs/${file} has no decorative emoji`, () => {
      expectNoDecorativeEmoji(`dashboard/js/views/analytics/tabs/${file}`);
    });
  });
});
