// @vitest-environment happy-dom
//
// Rendering release notes, which are the one piece of remote text this
// application displays.
//
// Two things are being proved. The first is that a real changelog reads as one
// rather than as raw Markdown in a monospace box. The second matters more: no
// path through here can put markup into the page. The notes come from GitHub
// over the network into a window that can drive the local API, so `innerHTML`
// is never used and every string reaches the DOM as text.
import { beforeEach, describe, expect, it } from 'vitest';

import { renderMarkdown } from '../src/renderer/ui/markdown';

let host: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  host = document.createElement('div');
  document.body.append(host);
});

function render(source: string): HTMLElement {
  host.replaceChildren(renderMarkdown(source));
  return host;
}

describe('what it will not do', () => {
  it('never turns markup in the notes into elements', () => {
    // The whole reason the notes used to be plain text. A release body is
    // written by whoever cut the release; it is not trusted markup.
    const hostile = [
      '<img src=x onerror="alert(1)">',
      '<script>alert(1)</script>',
      '<a href="javascript:alert(1)">click</a>',
      '<iframe src="https://example.com"></iframe>'
    ].join('\n\n');

    const out = render(hostile);

    expect(out.querySelector('img')).toBeNull();
    expect(out.querySelector('script')).toBeNull();
    expect(out.querySelector('iframe')).toBeNull();
    expect(out.querySelector('a')).toBeNull();
    // It survives as visible text, which is the honest outcome.
    expect(out.textContent).toContain('<script>alert(1)</script>');
  });

  it('renders a link as its label, never as something clickable', () => {
    // A clickable link from remote text is a navigation this window should not
    // offer, however well-formed the URL looks.
    const out = render('See [the changelog](https://example.com/evil) for details.');

    expect(out.querySelector('a')).toBeNull();
    expect(out.textContent).toContain('the changelog');
    expect(out.textContent).not.toContain('example.com');
  });

  it('does not execute or expose markup hidden inside a code fence', () => {
    const out = render(['```html', '<script>alert(1)</script>', '```'].join('\n'));

    expect(out.querySelector('script')).toBeNull();
    expect(out.querySelector('pre')?.textContent).toBe('<script>alert(1)</script>');
  });
});

describe('what it renders', () => {
  it('makes headings into headings, shifted below the dialog title', () => {
    // The modal's own title is an h2, so a level-1 heading in the notes must
    // not outrank it.
    const out = render('# Multi-Git v4.0.0\n\n## In plain terms');

    expect(out.querySelector('h3')?.textContent).toBe('Multi-Git v4.0.0');
    expect(out.querySelector('h4')?.textContent).toBe('In plain terms');
    expect(out.querySelector('h1')).toBeNull();
  });

  it('renders bullet lists as lists', () => {
    const out = render('- first\n- second\n- third');

    expect(out.querySelectorAll('ul li')).toHaveLength(3);
    expect(out.querySelector('ul li')?.textContent).toBe('first');
  });

  it('keeps a wrapped bullet as one item, which is how changelogs are written', () => {
    const out = render(['- **Something changed.** The first line', '  and its continuation.'].join('\n'));

    const items = out.querySelectorAll('ul li');
    expect(items).toHaveLength(1);
    expect(items[0]?.textContent).toContain('and its continuation');
  });

  it('renders numbered lists', () => {
    const out = render('1. one\n2. two');

    expect(out.querySelectorAll('ol li')).toHaveLength(2);
  });

  it('renders bold and inline code', () => {
    const out = render('A **bold** claim about `git status`.');

    expect(out.querySelector('strong')?.textContent).toBe('bold');
    expect(out.querySelector('code')?.textContent).toBe('git status');
  });

  it('keeps a fenced block verbatim, including its line breaks', () => {
    const out = render(['```powershell', 'Get-FileHash -Algorithm SHA256 file', '```'].join('\n'));

    expect(out.querySelector('pre.md-code')?.textContent).toBe(
      'Get-FileHash -Algorithm SHA256 file'
    );
  });

  it('renders a horizontal rule', () => {
    expect(render('above\n\n---\n\nbelow').querySelector('hr')).not.toBeNull();
  });

  it('joins wrapped prose into one paragraph', () => {
    // Changelog prose is hard-wrapped at 80 columns; rendering each line as its
    // own paragraph would double-space the whole announcement.
    const out = render('This sentence was\nwrapped across\nthree lines.');

    expect(out.querySelectorAll('p')).toHaveLength(1);
    expect(out.querySelector('p')?.textContent).toBe('This sentence was wrapped across three lines.');
  });
});

describe('what it does with input it cannot parse', () => {
  it('survives an unterminated code fence', () => {
    expect(() => render('```\nnever closed')).not.toThrow();
    expect(render('```\nnever closed').textContent).toContain('never closed');
  });

  it('leaves a stray marker as text rather than losing it', () => {
    expect(render('an ** unclosed bold').textContent).toContain('an ** unclosed bold');
  });

  it('renders nothing for nothing', () => {
    expect(render('').childNodes).toHaveLength(0);
    expect(render('\n\n  \n').childNodes).toHaveLength(0);
  });
});
