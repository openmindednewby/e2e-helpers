import { decodeMailSource, extractLink, tokenOfLink, type CapturedEmail } from '../src/mailMessage';

const CRLF = '\r\n';

function email(bodyText: string, bodyHtml?: string): CapturedEmail {
  return { uid: 1, subject: 's', to: 't', bodyText, bodyHtml };
}

describe('decodeMailSource', () => {
  it('multipart quoted-printable with a wrapped token link, decodes the escape and rejoins the line', () => {
    const source = [
      'Content-Type: multipart/alternative; boundary="b1"',
      '',
      '--b1',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'Go https://a.example/verify-email?token=3Dabc=',
      'def',
      '--b1',
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from('<a href="https://a.example/h">x</a>').toString('base64'),
      '--b1--',
    ].join(CRLF);

    const decoded = decodeMailSource(source);

    expect(decoded.bodyText).toBe('Go https://a.example/verify-email?token=abcdef');
    expect(decoded.bodyHtml).toBe('<a href="https://a.example/h">x</a>');
  });

  it('a single part with a folded content type, reads the body', () => {
    const source = ['Content-Type: text/plain;', ' charset=utf-8', '', 'hello'].join(CRLF);

    const decoded = decodeMailSource(source);

    expect(decoded.bodyText).toBe('hello');
    expect(decoded.bodyHtml).toBeUndefined();
  });
});

describe('extractLink', () => {
  it('an html href with an entity, returns the link decoded', () => {
    const mail = email('', '<a href="https://a.example/verify-email?x=1&amp;token=t1">go</a>');

    const link = extractLink(mail, '/verify-email');

    expect(link).toBe('https://a.example/verify-email?x=1&token=t1');
  });

  it('no link with the fragment, returns null', () => {
    const mail = email('see https://a.example/other');

    const link = extractLink(mail, '/verify-email');

    expect(link).toBeNull();
  });
});

describe('extractLink closing parenthesis', () => {
  it('a link followed by a closing parenthesis in text, returns the link without it', () => {
    const mail = email('Confirm (https://a.example/verify-email?token=abc) now');

    const link = extractLink(mail, '/verify-email');

    expect(link).toBe('https://a.example/verify-email?token=abc');
  });
});

describe('tokenOfLink', () => {
  it('an encoded token, returns it decoded', () => {
    const token = tokenOfLink('https://a.example/x?token=a%2Bb');

    expect(token).toBe('a+b');
  });

  it('text that is not a url, returns null', () => {
    const token = tokenOfLink('not a url');

    expect(token).toBeNull();
  });
});
