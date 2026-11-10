import { chromium, type Browser, type Page } from '@playwright/test';

import { defaultHideCss, worstContrastOverColours, worstPaintedTextContrast } from '../src/paintedContrast';

const BROWSER_TIMEOUT_MS = 60_000;
const WHITE = 0xffffff;
const BLACK = 0x000000;
const GREY_77 = 0x777777;
const OPAQUE_WHITE = [255, 255, 255, 255];

describe('worstContrastOverColours', () => {
  it('with white text over black, returns 21', () => {
    const ratio = worstContrastOverColours(OPAQUE_WHITE, [BLACK]);

    expect(ratio).toBeCloseTo(21, 5);
  });

  it('with white text over black and grey, returns the grey ratio', () => {
    const ratio = worstContrastOverColours(OPAQUE_WHITE, [BLACK, GREY_77]);

    expect(ratio).toBeCloseTo(4.48, 2);
  });

  it('with half-transparent white text over black, blends before measuring', () => {
    const ratio = worstContrastOverColours([255, 255, 255, 128], [BLACK]);

    expect(ratio).toBeLessThan(6);
  });

  it('with fully transparent text, returns 1', () => {
    const ratio = worstContrastOverColours([255, 255, 255, 0], [WHITE]);

    expect(ratio).toBe(1);
  });

  it('with no colours, returns Infinity', () => {
    const ratio = worstContrastOverColours(OPAQUE_WHITE, []);

    expect(ratio).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('defaultHideCss', () => {
  it('with a selector list, wraps the whole list so descendants of each part are hidden', () => {
    const css = defaultHideCss('.a, .b');

    expect(css.startsWith(':is(.a, .b),:is(.a, .b) *{')).toBe(true);
  });
});

describe('worstPaintedTextContrast', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 400, height: 300 } });
  }, BROWSER_TIMEOUT_MS);

  afterAll(async () => {
    await browser.close();
  });

  const render = (body: string): Promise<void> => page.setContent(`<body style="margin:0;background:#000">${body}</body>`);

  it('with white text on black, ignores the glyphs and returns 21', async () => {
    await render('<p id="t" style="margin:0;color:#fff">Hello</p>');

    const ratio = await worstPaintedTextContrast(page, { textSelector: '#t' });

    expect(ratio).toBeCloseTo(21, 5);
  }, BROWSER_TIMEOUT_MS);

  it('with a background that turns grey under the text, returns the grey ratio', async () => {
    await render('<p id="t" style="margin:0;width:200px;color:#fff;background:linear-gradient(90deg,#000 50%,#777 50%)">Hello hello hello hello hello hello</p>');

    const ratio = await worstPaintedTextContrast(page, { textSelector: '#t' });

    expect(ratio).toBeCloseTo(4.48, 2);
  }, BROWSER_TIMEOUT_MS);

  it('with an oklch text colour, measures the resolved colour', async () => {
    await render('<p id="t" style="margin:0;color:oklch(1 0 0)">Hello</p>');

    const ratio = await worstPaintedTextContrast(page, { textSelector: '#t' });

    expect(ratio).toBeCloseTo(21, 0);
  }, BROWSER_TIMEOUT_MS);

  it('with a selector list, takes the worst element', async () => {
    await render('<p class="a" style="margin:0;color:#fff">One</p><p class="b" style="margin:0;color:#777">Two</p>');

    const ratio = await worstPaintedTextContrast(page, { textSelector: '.a, .b' });

    expect(ratio).toBeCloseTo(4.69, 2);
  }, BROWSER_TIMEOUT_MS);

  it('with custom hideCss, paints what the option leaves visible', async () => {
    await render('<p id="t" style="margin:0;color:#fff">Hello</p>');

    const ratio = await worstPaintedTextContrast(page, { textSelector: '#t', hideCss: 'body{background:#fff!important}#t{color:transparent!important}' });

    expect(ratio).toBe(1);
  }, BROWSER_TIMEOUT_MS);

  it('after measuring, removes the hiding style', async () => {
    await render('<p id="t" style="margin:0;color:#fff">Hello</p>');

    await worstPaintedTextContrast(page, { textSelector: '#t' });

    expect(await page.evaluate(() => getComputedStyle(document.querySelector('#t') as Element).color)).toBe('rgb(255, 255, 255)');
  }, BROWSER_TIMEOUT_MS);

  it('with text below the viewport only, throws instead of passing', async () => {
    await render('<p id="t" style="margin:2000px 0 0;color:#fff">Hello</p>');

    const measuring = worstPaintedTextContrast(page, { textSelector: '#t' });

    await expect(measuring).rejects.toThrow('no visible text in the viewport matched #t');
  }, BROWSER_TIMEOUT_MS);

  it('with hidden text only, throws instead of passing', async () => {
    await render('<p id="t" style="visibility:hidden;color:#fff">Hello</p>');

    const measuring = worstPaintedTextContrast(page, { textSelector: '#t' });

    await expect(measuring).rejects.toThrow('no visible text in the viewport matched #t');
  }, BROWSER_TIMEOUT_MS);
});
