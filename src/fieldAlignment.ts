import type { Locator, Page } from '@playwright/test';

export const FIELD_ALIGNMENT_DEFAULT_TOLERANCE_PX = 1;
export const FIELD_CONTROL_SELECTOR =
  'input:not([type="hidden"]), select, textarea, button, [role="button"], [role="combobox"]';

const HALF = 2;

export interface ControlBox {
  label: string;
  top: number;
  height: number;
}

export interface FieldAlignmentOffender extends ControlBox {
  row: number;
  topDelta: number;
  heightDelta: number;
}

export interface ExpectFieldsAlignedOptions {
  tolerancePx?: number;
  controlSelector?: string;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / HALF);
  if (sorted.length % HALF === 0) {return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / HALF;}
  return sorted[mid] ?? 0;
}

/** Controls in each row whose top or height differs from the row median by more than `tolerancePx`. */
export function findMisalignedControls(
  rows: ControlBox[][],
  tolerancePx: number = FIELD_ALIGNMENT_DEFAULT_TOLERANCE_PX,
): FieldAlignmentOffender[] {
  return rows.flatMap((boxes, row) => {
    if (boxes.length < HALF) {return [];}
    const referenceTop = median(boxes.map((box) => box.top));
    const referenceHeight = median(boxes.map((box) => box.height));
    return boxes
      .map((box) => ({ ...box, row, topDelta: box.top - referenceTop, heightDelta: box.height - referenceHeight }))
      .filter((box) => Math.abs(box.topDelta) > tolerancePx || Math.abs(box.heightDelta) > tolerancePx);
  });
}

/** One line per offender: row, control, and how far its top and height are off. */
export function formatMisalignment(offenders: FieldAlignmentOffender[], tolerancePx: number): string {
  const lines = offenders.map(
    (o) =>
      `  row ${String(o.row)} ${o.label}: top ${o.topDelta.toFixed(1)}px, height ${o.heightDelta.toFixed(1)}px`,
  );
  return [`expectFieldsAligned: ${String(offenders.length)} control(s) off by more than ${String(tolerancePx)}px`, ...lines].join('\n');
}

async function describeControl(control: Locator, index: number): Promise<string> {
  const testId = await control.getAttribute('data-testid');
  if (testId !== null) {return testId;}
  const ariaLabel = await control.getAttribute('aria-label');
  if (ariaLabel !== null) {return ariaLabel;}
  const name = await control.getAttribute('name');
  return name ?? `control #${String(index)}`;
}

async function measureControl(control: Locator, index: number): Promise<ControlBox | null> {
  if (!(await control.isVisible())) {return null;}
  const box = await control.boundingBox();
  if (box === null) {return null;}
  return { label: await describeControl(control, index), top: box.y, height: box.height };
}

async function measureRow(row: Locator, selector: string): Promise<ControlBox[]> {
  const controls = await row.locator(selector).all();
  const boxes = await Promise.all(controls.map((control, index) => measureControl(control, index)));
  return boxes.filter((box): box is ControlBox => box !== null);
}

/** Fails unless every visible control in each row shares one top edge and one height (D-ALL-22). */
export async function expectFieldsAligned(
  page: Page,
  rowLocator: Locator | string,
  options: ExpectFieldsAlignedOptions = {},
): Promise<void> {
  const tolerancePx = options.tolerancePx ?? FIELD_ALIGNMENT_DEFAULT_TOLERANCE_PX;
  const selector = options.controlSelector ?? FIELD_CONTROL_SELECTOR;
  const rows = typeof rowLocator === 'string' ? page.locator(rowLocator) : rowLocator;
  const rowLocators = await rows.all();
  if (rowLocators.length === 0) {throw new Error('expectFieldsAligned: the row locator matched no element');}
  const measured = await Promise.all(rowLocators.map((row) => measureRow(row, selector)));
  const offenders = findMisalignedControls(measured, tolerancePx);
  if (offenders.length > 0) {throw new Error(formatMisalignment(offenders, tolerancePx));}
}
