#!/usr/bin/env node
'use strict';

/* Rasterises the PNG icon fallbacks from assets/mark.svg.
 *
 *   node tools/icons.js
 *
 * Only needed when the mark changes. Chromium does the rendering, so this is
 * the one script in the repo that wants a browser — everything else is
 * dependency-free. The generated PNGs are committed, so a normal build and a
 * normal checkout never run this.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ASSETS = path.join(ROOT, 'assets');

// Apple rounds the touch icon itself, so that one is rendered full-bleed and
// square — our own rounded corners would show up as a double rounding.
const TARGETS = [
  { file: 'favicon-32.png', size: 32, square: false },
  { file: 'favicon-192.png', size: 192, square: false },
  { file: 'apple-touch-icon.png', size: 180, square: true },
];

function loadChromium() {
  for (const spec of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try {
      return require(spec).chromium;
    } catch (err) {
      /* try the next one */
    }
  }
  throw new Error(
    'Playwright is not available. The committed PNGs in assets/ are already ' +
      'current — you only need this script if you changed assets/mark.svg.'
  );
}

(async () => {
  const chromium = loadChromium();
  const svg = fs.readFileSync(path.join(ASSETS, 'mark.svg'), 'utf8');

  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
  );

  for (const { file, size, square } of TARGETS) {
    const markup = square ? svg.replace(/ rx="14"/, '') : svg;
    const src = 'data:image/svg+xml;base64,' + Buffer.from(markup).toString('base64');

    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(
      `<style>html,body{margin:0;padding:0;background:transparent}
       img{display:block;width:${size}px;height:${size}px}</style>
       <img src="${src}">`
    );
    await page.locator('img').screenshot({
      path: path.join(ASSETS, file),
      omitBackground: !square,
    });
    await page.close();
    console.log(`  ${file.padEnd(22)} ${size}x${size}`);
  }

  await browser.close();
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
