// A small, safe Markdown renderer for text that came from somewhere else.
//
// Release notes arrive from GitHub over the network, which makes them the one
// piece of remote text this application displays. They used to be dropped into
// a <pre> as-is, so a real announcement showed as raw Markdown in a monospace
// box -- hashes, asterisks and all -- cut off at two thousand characters.
//
// The reason it was plain text is sound and is preserved: `innerHTML` on remote
// content is how a rendering mistake becomes code execution in a page that can
// drive the local API. So nothing here parses HTML or assigns markup. Every
// element is constructed, every string reaches the DOM through `textContent`,
// and anything unrecognised falls through as text.
//
// Deliberately a subset. Headings, emphasis, inline code, fenced code, lists,
// rules and paragraphs cover what a changelog is made of. No images, no tables,
// no raw HTML, and links render as text rather than as anchors -- a clickable
// link from remote text is a navigation this window should not offer.
import { el } from '../dom/create';

/** `**bold**` and `` `code` ``, applied to one line of text. */
function inline(text: string): Node[] {
  const nodes: Node[] = [];
  // One pass over both forms, so `**a `b` c**` cannot nest its way into
  // something unexpected: whichever opens first wins the span.
  const pattern = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g;

  let index = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > index) {
      nodes.push(document.createTextNode(text.slice(index, match.index)));
    }

    if (match[1] !== undefined) {
      nodes.push(el('strong', { text: match[1] }));
    } else if (match[2] !== undefined) {
      nodes.push(el('code', { text: match[2] }));
    } else if (match[3] !== undefined) {
      // The label, not an anchor. Remote text does not get to decide where this
      // window navigates.
      nodes.push(el('span', { className: 'md-link', text: match[3] }));
    }

    index = match.index + match[0].length;
  }

  if (index < text.length) {
    nodes.push(document.createTextNode(text.slice(index)));
  }

  return nodes;
}

/**
 * Renders a subset of Markdown into a fragment.
 *
 * Never throws on malformed input: an unterminated fence or a stray marker
 * becomes text, which is the right outcome for notes written by someone else.
 */
export function renderMarkdown(source: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const lines = source.replace(/\r\n/g, '\n').split('\n');

  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';

    // Fenced code, kept verbatim.
    if (line.trimStart().startsWith('```')) {
      const body: string[] = [];
      index++;

      while (index < lines.length && !(lines[index] ?? '').trimStart().startsWith('```')) {
        body.push(lines[index] ?? '');
        index++;
      }
      index++;

      fragment.append(el('pre', { className: 'md-code', text: body.join('\n') }));
      continue;
    }

    if (line.trim() === '') {
      index++;
      continue;
    }

    // A rule, but only a real one: `---` under text is a setext heading in some
    // dialects and a horizontal rule here, which is close enough for notes.
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      fragment.append(el('hr', { className: 'md-rule' }));
      index++;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      // Shifted down and capped: this renders inside a dialog whose own title is
      // the h2, so a level-1 heading in the notes should not outrank it.
      const depth = Math.min(heading[1]?.length ?? 1, 4);
      const tag = (['h3', 'h4', 'h5', 'h6'] as const)[depth - 1] ?? 'h6';
      const node = el(tag, { className: 'md-heading' });
      node.append(...inline(heading[2] ?? ''));
      fragment.append(node);
      index++;
      continue;
    }

    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const list = el(ordered ? 'ol' : 'ul', { className: 'md-list' });

      while (index < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[index] ?? '')) {
        const item = el('li');
        item.append(...inline((lines[index] ?? '').replace(/^\s*([-*+]|\d+\.)\s+/, '')));
        list.append(item);
        index++;

        // A wrapped continuation line belongs to the item above it.
        while (
          index < lines.length &&
          (lines[index] ?? '').trim() !== '' &&
          /^\s{2,}\S/.test(lines[index] ?? '') &&
          !/^\s*([-*+]|\d+\.)\s+/.test(lines[index] ?? '')
        ) {
          item.append(document.createTextNode(' '), ...inline((lines[index] ?? '').trim()));
          index++;
        }
      }

      fragment.append(list);
      continue;
    }

    // A paragraph: this line and the ones that follow it without a blank.
    const paragraph: string[] = [];
    while (
      index < lines.length &&
      (lines[index] ?? '').trim() !== '' &&
      !/^\s*(#{1,6}\s|```|([-*+]|\d+\.)\s)/.test(lines[index] ?? '') &&
      !/^\s*([-*_])\1{2,}\s*$/.test(lines[index] ?? '')
    ) {
      paragraph.push((lines[index] ?? '').trim());
      index++;
    }

    const node = el('p', { className: 'md-paragraph' });
    node.append(...inline(paragraph.join(' ')));
    fragment.append(node);
  }

  return fragment;
}
