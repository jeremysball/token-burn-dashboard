/**
 * Regression test: dashboard/index.html must load both main.css and
 * design-v2.css, with design-v2.css linked AFTER main.css so it owns the
 * badge / top-model / hero / insights component styles.
 *
 * This guards Task 6: if the link order or presence regresses, the live
 * dashboard loses its v2 component styling.
 */

import fs from 'fs';
import path from 'path';

const indexHtml = fs.readFileSync(
  path.resolve(process.cwd(), 'dashboard/index.html'),
  'utf8'
);

describe('dashboard stylesheet links', () => {
  it('links main.css', () => {
    expect(indexHtml).toMatch(/dashboard\/styles\/main\.css/);
  });

  it('links design-v2.css after main.css', () => {
    const mainIdx = indexHtml.indexOf('dashboard/styles/main.css');
    const v2Idx = indexHtml.indexOf('dashboard/styles/design-v2.css');
    expect(mainIdx).toBeGreaterThanOrEqual(0);
    expect(v2Idx).toBeGreaterThan(mainIdx);
  });
});
