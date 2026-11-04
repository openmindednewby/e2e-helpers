export interface CapturedEmail {
  uid: number;
  subject: string;
  to: string;
  bodyText: string;
  bodyHtml?: string;
}

interface DecodedBodies {
  text?: string;
  html?: string;
}

const HEADER_BREAK = /\r?\n\r?\n/;
const QP_SOFT_BREAK = /=\r?\n/g;
const QP_ESCAPE = /=([0-9A-Fa-f]{2})/g;
const BOUNDARY = /boundary="?([^";\s]+)"?/i;
const URL_IN_BODY = /https?:\/\/[^\s"'<>)]+/gi;
const HEX = 16;

function splitAtHeaders(raw: string): { headers: string; body: string } {
  const breakAt = HEADER_BREAK.exec(raw);
  if (!breakAt) {return { headers: '', body: raw };}
  return { headers: raw.slice(0, breakAt.index), body: raw.slice(breakAt.index + breakAt[0].length) };
}

function headerValue(headers: string, name: string): string {
  const prefix = `${name.toLowerCase()}:`;
  const lines = headers.split(/\r?\n/);
  const start = lines.findIndex(line => line.toLowerCase().startsWith(prefix));
  if (start < 0) {return '';}
  let value = (lines[start] ?? '').slice(prefix.length).trim();
  for (let i = start + 1; i < lines.length && /^\s/.test(lines[i] ?? ''); i += 1) {
    value += ` ${(lines[i] ?? '').trim()}`;
  }
  return value;
}

function decodeQuotedPrintable(body: string): string {
  const unfolded = body.replace(QP_SOFT_BREAK, '');
  const latin = unfolded.replace(QP_ESCAPE, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, HEX)));
  return Buffer.from(latin, 'latin1').toString('utf8');
}

function decodeBody(body: string, encoding: string): string {
  const name = encoding.toLowerCase();
  if (name === 'quoted-printable') {return decodeQuotedPrintable(body);}
  if (name === 'base64') {return Buffer.from(body, 'base64').toString('utf8');}
  return body;
}

function collectBodies(raw: string, found: DecodedBodies): void {
  const { headers, body } = splitAtHeaders(raw);
  const contentType = headerValue(headers, 'Content-Type');
  const boundary = BOUNDARY.exec(contentType)?.[1];
  if (contentType.toLowerCase().startsWith('multipart/') && boundary) {
    const parts = body.split(`--${boundary}`).slice(1);
    parts.filter(part => !part.startsWith('--')).forEach(part => collectBodies(part.replace(/^\r?\n/, ''), found));
    return;
  }
  const decoded = decodeBody(body, headerValue(headers, 'Content-Transfer-Encoding')).trim();
  if (contentType.toLowerCase().startsWith('text/html')) {
    found.html ??= decoded;
    return;
  }
  found.text ??= decoded;
}

/** Decodes a raw RFC 822 source into its first plain-text and HTML bodies, multipart and transfer encodings included. */
export function decodeMailSource(source: string): { bodyText: string; bodyHtml?: string } {
  const found: DecodedBodies = {};
  collectBodies(source, found);
  return { bodyText: found.text ?? '', bodyHtml: found.html };
}

function linksIn(email: CapturedEmail): string[] {
  const body = `${email.bodyHtml ?? ''}\n${email.bodyText}`;
  return (body.match(URL_IN_BODY) ?? []).map(link => link.replace(/&amp;/g, '&'));
}

/** First link in the email whose text contains `fragment`. */
export function extractLink(email: CapturedEmail, fragment: string): string | null {
  const wanted = fragment.toLowerCase();
  return linksIn(email).find(link => link.toLowerCase().includes(wanted)) ?? null;
}

/** The decoded `token` query value of a link, or null. */
export function tokenOfLink(link: string): string | null {
  try {
    return new URL(link).searchParams.get('token');
  } catch {
    return null;
  }
}

export function extractVerifyUrl(email: CapturedEmail): string | null {
  return extractLink(email, 'verify');
}

export function extractResetUrl(email: CapturedEmail): string | null {
  return extractLink(email, '/reset-password');
}

export function extractResetToken(email: CapturedEmail): string | null {
  const url = extractResetUrl(email);
  return url === null ? null : tokenOfLink(url);
}

export function extractUnsubscribeUrl(email: CapturedEmail): string | null {
  return extractLink(email, '/unsubscribe/');
}
