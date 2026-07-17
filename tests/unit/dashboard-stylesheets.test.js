/**
 * Regression test: dashboard/index.html must load both main.css and
 * design-v2.css (main.css first, design-v2 second) so design-v2 owns the
 * badge / top-model / hero / insights component styles. design-v2 must carry
 * the real layout for the owned selectors (hero + insights grids), and
 * main.css must no longer define those base component rules.
 *
 * Guards Task 6 and its review fixup: if the link order/version regresses, or
 * if design-v2 loses the grid layout it now owns, the live dashboard breaks.
 */

import fs from 'fs';
import path from 'path';

const root = process.cwd();
const indexHtml = fs.readFileSync(
  path.resolve(root, 'dashboard/index.html'),
  'utf8'
);
const mainCss = fs.readFileSync(
  path.resolve(root, 'dashboard/styles/main.css'),
  'utf8'
);
const designV2Css = fs.readFileSync(
  path.resolve(root, 'dashboard/styles/design-v2.css'),
  'utf8'
);

function stylesheetLinks(html) {
  const links = [];
  const re = /<link\s+rel="stylesheet"\s+href="([^"]+)"\s*\/?>/g;
  let m;
  while ((m = re.exec(html)) !== null) links.push(m[1]);
  return links;
}

describe('dashboard stylesheet links', () => {
  it('links main.css then design-v2.css in document order', () => {
    const links = stylesheetLinks(indexHtml);
    const mainIdx = links.indexOf('/dashboard/styles/main.css?v=12');
    const v2Idx = links.indexOf('/dashboard/styles/design-v2.css?v=12');
    expect(mainIdx).toBeGreaterThanOrEqual(0);
    expect(v2Idx).toBeGreaterThan(mainIdx);
  });

  it('uses cache-busting version ?v=12 on both stylesheets', () => {
    const links = stylesheetLinks(indexHtml);
    expect(links).toContain('/dashboard/styles/main.css?v=12');
    expect(links).toContain('/dashboard/styles/design-v2.css?v=12');
  });
});

describe('owned selectors removed from main.css', () => {
  it('no longer defines badge or top-model-name rules', () => {
    expect(/\.(pricing-source-badge|top-model-name)\s*\{/.test(mainCss)).toBe(
      false
    );
  });

  it('no longer defines the hero-section grid layout', () => {
    expect(/\.hero-section\s*\{\s*display\s*:\s*grid/.test(mainCss)).toBe(
      false
    );
  });

  it('no longer defines any .insights-grid rule blocks', () => {
    expect(/\.insights-grid\s*\{/.test(mainCss)).toBe(false);
  });
});

describe('design-v2.css owns the live layout', () => {
  it('defines .hero-section as a 2-column grid', () => {
    expect(/\.hero-section\s*\{[^}]*display\s*:\s*grid/.test(designV2Css)).toBe(
      true
    );
    expect(
      /\.hero-section\s*\{[^}]*grid-template-columns\s*:\s*[^;]+2fr/.test(
        designV2Css
      )
    ).toBe(true);
  });

  it('defines .insights-grid as a 4-column grid', () => {
    expect(/\.insights-grid\s*\{[^}]*display\s*:\s*grid/.test(designV2Css)).toBe(
      true
    );
    expect(
      /\.insights-grid\s*\{[^}]*grid-template-columns\s*:\s*repeat\(4/.test(
        designV2Css
      )
    ).toBe(true);
  });

  it('preserves the .hero-value.pulse animation', () => {
    expect(/\.hero-value\.pulse\s*\{/.test(designV2Css)).toBe(true);
    expect(/@keyframes\s+pulse-value\s*\{/.test(designV2Css)).toBe(true);
  });

  it('declares the responsive insights-grid layouts (2-col and 1-col)', () => {
    expect(/@media[^{]*1200px[^{]*\{[^}]*\.insights-grid\s*\{[^}]*repeat\(2/.test(designV2Css)).toBe(true);
    expect(/@media[^{]*640px[^{]*\{[^}]*\.insights-grid\s*\{[^}]*grid-template-columns\s*:\s*1fr/.test(designV2Css)).toBe(true);
  });
});
