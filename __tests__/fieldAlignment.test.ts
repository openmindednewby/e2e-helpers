import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { chromium, type Browser, type Page } from '@playwright/test';

import { expectFieldsAligned, findMisalignedControls, formatMisalignment } from '../src/fieldAlignment';

const BROWSER_TIMEOUT_MS = 60_000;
const fixture = readFileSync(join(__dirname, 'fixtures', 'form-rows.html'), 'utf8');

describe('findMisalignedControls', () => {
  it('with two inputs and a button 21px higher, flags only the button', () => {
    const rows = [[
      { label: 'email', top: 40, height: 44 },
      { label: 'tier', top: 40, height: 44 },
      { label: 'send', top: 19, height: 44 },
    ]];

    const offenders = findMisalignedControls(rows, 1);

    expect(offenders.map((o) => [o.label, o.topDelta])).toEqual([['send', -21]]);
  });

  it('with a 1px top drift and a 1px height drift, flags nothing at a 1px tolerance', () => {
    const rows = [[
      { label: 'email', top: 40, height: 44 },
      { label: 'send', top: 41, height: 45 },
      { label: 'tier', top: 40, height: 44 },
    ]];

    const offenders = findMisalignedControls(rows, 1);

    expect(offenders).toEqual([]);
  });

  it('with a single control in the row, flags nothing', () => {
    const offenders = findMisalignedControls([[{ label: 'only', top: 0, height: 10 }]], 1);

    expect(offenders).toEqual([]);
  });
});

describe('formatMisalignment', () => {
  it('with one offender, names its row, control and both deltas', () => {
    const message = formatMisalignment([{ label: 'send', top: 19, height: 36, row: 2, topDelta: -21, heightDelta: -8 }], 1);

    expect(message).toContain('row 2 send: top -21.0px, height -8.0px');
  });
});

describe('expectFieldsAligned against the static fixture', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch();
    page = await browser.newPage();
    await page.setContent(fixture);
  }, BROWSER_TIMEOUT_MS);

  afterAll(async () => {
    await browser.close();
  });

  it('with the button under a hidden label line, passes', async () => {
    await expect(expectFieldsAligned(page, '[data-testid="aligned-row"]', { tolerancePx: 1 })).resolves.toBeUndefined();
  });

  it('with the planted button on the label line, fails naming that button', async () => {
    await expect(expectFieldsAligned(page, '[data-testid="planted-row"]', { tolerancePx: 1 })).rejects.toThrow(
      /send-on-label-line: top -/,
    );
  });

  it('with a 36px button beside 44px inputs, fails on height', async () => {
    await expect(expectFieldsAligned(page, '[data-testid="short-button-row"]', { tolerancePx: 1 })).rejects.toThrow(
      /apply-short: top .*height -8\.0px/,
    );
  });

  it('with a row locator that matches nothing, fails instead of passing vacuously', async () => {
    await expect(expectFieldsAligned(page, '[data-testid="no-such-row"]')).rejects.toThrow(/matched no element/);
  });
});
