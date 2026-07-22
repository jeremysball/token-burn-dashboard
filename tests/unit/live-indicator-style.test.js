const fs = require('fs');
const path = require('path');

describe('live status indicator', () => {
  it('uses an in-flow status dot instead of an absolute overlay', () => {
    const css = fs.readFileSync(
      path.resolve(process.cwd(), 'dashboard/styles/design-v2.css'),
      'utf8'
    );
    const rules = [...css.matchAll(/\.live-indicator\s*\{([^}]*)\}/g)];
    const liveIndicator = rules.at(-1)?.[1] || '';

    expect(liveIndicator).toMatch(/display\s*:\s*inline-flex/);
    expect(liveIndicator).toMatch(/border-radius\s*:\s*0/);
  });
});
