import type { Page } from '@playwright/test';

const WCAG_LINEAR_THRESHOLD = 0.03928;
const WCAG_LINEAR_DIVISOR = 12.92;
const WCAG_GAMMA_OFFSET = 0.055;
const WCAG_GAMMA_DIVISOR = 1.055;
const WCAG_GAMMA_EXPONENT = 2.4;
const WCAG_FLARE = 0.05;
const RED_WEIGHT = 0.2126;
const GREEN_WEIGHT = 0.7152;
const BLUE_WEIGHT = 0.0722;
const CHANNEL_MAX = 255;
const RED_SHIFT = 65536;
const GREEN_SHIFT = 256;

export interface PaintedContrastOptions {
  textSelector: string;
  hideCss?: string;
}

export interface PaintedTextBox {
  x: number;
  y: number;
  width: number;
  height: number;
  rgba: number[];
}

function linearChannel(value: number): number {
  const scaled = value / CHANNEL_MAX;
  if (scaled <= WCAG_LINEAR_THRESHOLD) {return scaled / WCAG_LINEAR_DIVISOR;}
  return ((scaled + WCAG_GAMMA_OFFSET) / WCAG_GAMMA_DIVISOR) ** WCAG_GAMMA_EXPONENT;
}

function relativeLuminance(red: number, green: number, blue: number): number {
  return RED_WEIGHT * linearChannel(red) + GREEN_WEIGHT * linearChannel(green) + BLUE_WEIGHT * linearChannel(blue);
}

function contrastOverColour(rgba: number[], colour: number): number {
  const [textRed = 0, textGreen = 0, textBlue = 0, textAlpha = CHANNEL_MAX] = rgba;
  const red = Math.floor(colour / RED_SHIFT);
  const green = Math.floor(colour / GREEN_SHIFT) % GREEN_SHIFT;
  const blue = colour % GREEN_SHIFT;
  const opacity = textAlpha / CHANNEL_MAX;
  const blend = (text: number, under: number): number => text * opacity + under * (1 - opacity);
  const textLuminance = relativeLuminance(blend(textRed, red), blend(textGreen, green), blend(textBlue, blue));
  const underLuminance = relativeLuminance(red, green, blue);
  return (Math.max(textLuminance, underLuminance) + WCAG_FLARE) / (Math.min(textLuminance, underLuminance) + WCAG_FLARE);
}

/** Lowest WCAG ratio of a text colour, alpha blended, over colours packed as `r * 65536 + g * 256 + b`. */
export function worstContrastOverColours(rgba: number[], colours: number[]): number {
  return colours.reduce((worst, colour) => Math.min(worst, contrastOverColour(rgba, colour)), Number.POSITIVE_INFINITY);
}

/** CSS that makes the text matched by `textSelector`, and its descendants, paint nothing. */
export function defaultHideCss(textSelector: string): string {
  const hidden = 'color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;transition:none!important';
  return `:is(${textSelector}),:is(${textSelector}) *{${hidden}}`;
}

function collectTextBoxes(selector: string): PaintedTextBox[] {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) {throw new Error('worstPaintedTextContrast: no 2d canvas context');}
  const readColour = (css: string): number[] => {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = css;
    context.fillRect(0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data];
  };
  const boxes: PaintedTextBox[] = [];
  for (const element of document.querySelectorAll<HTMLElement>(selector)) {
    const style = getComputedStyle(element);
    const range = document.createRange();
    range.selectNodeContents(element);
    const rect = range.getBoundingClientRect();
    const x = Math.max(0, rect.left);
    const y = Math.max(0, rect.top);
    const width = Math.min(innerWidth, rect.right) - x;
    const height = Math.min(innerHeight, rect.bottom) - y;
    if (style.visibility !== 'hidden' && width > 0 && height > 0) {boxes.push({ x, y, width, height, rgba: readColour(style.color) });}
  }
  return boxes;
}

async function paintedColoursPerBox([base64, boxes]: [string, PaintedTextBox[]]): Promise<number[][]> {
  const image = new Image();
  image.src = `data:image/png;base64,${base64}`;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) {throw new Error('worstPaintedTextContrast: no 2d canvas context');}
  context.drawImage(image, 0, 0);
  const scale = image.width / innerWidth;
  return boxes.map((box) => {
    const left = Math.min(image.width - 1, Math.floor(box.x * scale));
    const top = Math.min(image.height - 1, Math.floor(box.y * scale));
    const right = Math.min(image.width, Math.ceil((box.x + box.width) * scale));
    const bottom = Math.min(image.height, Math.ceil((box.y + box.height) * scale));
    const { data } = context.getImageData(left, top, Math.max(1, right - left), Math.max(1, bottom - top));
    const colours = new Set<number>();
    for (let index = 0; index < data.length; index += 4) {
      colours.add((data[index] ?? 0) * 65536 + (data[index + 1] ?? 0) * 256 + (data[index + 2] ?? 0));
    }
    return [...colours];
  });
}

async function screenshotWithoutText(page: Page, hideCss: string): Promise<Buffer> {
  const style = await page.addStyleTag({ content: hideCss });
  try {
    return await page.screenshot();
  } finally {
    await style.evaluate((node) => { (node as Element).remove(); });
  }
}

/** Lowest contrast between each visible matched text colour and the pixels painted under it in the viewport. */
export async function worstPaintedTextContrast(page: Page, options: PaintedContrastOptions): Promise<number> {
  const { textSelector, hideCss = defaultHideCss(textSelector) } = options;
  const boxes = await page.evaluate(collectTextBoxes, textSelector);
  if (boxes.length === 0) {throw new Error(`worstPaintedTextContrast: no visible text in the viewport matched ${textSelector}`);}
  const shot = await screenshotWithoutText(page, hideCss);
  const colours = await page.evaluate(paintedColoursPerBox, [shot.toString('base64'), boxes] as [string, PaintedTextBox[]]);
  return Math.min(...boxes.map((box, index) => worstContrastOverColours(box.rgba, colours[index] ?? [])));
}
