// Small helpers for building DOM.
//
// Everything here sets text through `textContent`. Branch names, commit
// messages, file paths, and author names all come from a repository, which is
// not trusted input — cloning someone else's repository is the normal
// workflow. Building those into an HTML string is the one mistake this file
// exists to make inconvenient.

export interface ElementOptions {
  className?: string;
  /** Set via textContent, never parsed as HTML. */
  text?: string;
  title?: string;
  /** Applied as data-* attributes. */
  data?: Record<string, string | number | boolean | undefined>;
  /** Applied with setAttribute; use for aria-* and similar. */
  attrs?: Record<string, string>;
  children?: (Node | null | undefined)[];
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {}
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);

  if (options.className !== undefined) {
    element.className = options.className;
  }
  if (options.text !== undefined) {
    element.textContent = options.text;
  }
  if (options.title !== undefined) {
    element.title = options.title;
  }

  for (const [key, value] of Object.entries(options.data ?? {})) {
    if (value !== undefined) {
      element.dataset[key] = String(value);
    }
  }

  for (const [key, value] of Object.entries(options.attrs ?? {})) {
    element.setAttribute(key, value);
  }

  for (const child of options.children ?? []) {
    if (child) {
      element.appendChild(child);
    }
  }

  return element;
}

/**
 * A Material Symbols glyph.
 *
 * The icon name is the element's text, which is how the font works, so this
 * is the one place a "symbol" string legitimately becomes content.
 */
export function icon(name: string, sizePx?: number): HTMLSpanElement {
  const span = el('span', { className: 'material-symbols-outlined', text: name });
  if (sizePx !== undefined) {
    span.style.fontSize = `${sizePx}px`;
  }
  return span;
}

/** Replaces an element's children in one operation. */
export function replaceChildren(parent: Element, ...children: Node[]): void {
  parent.replaceChildren(...children);
}

/**
 * Builds many children into a fragment before attaching them.
 *
 * One append instead of N means one layout pass instead of N, which is what
 * makes the long file, branch, and history lists cheap to render.
 */
export function fragment(children: Iterable<Node>): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const child of children) {
    frag.appendChild(child);
  }
  return frag;
}

/** Shows or hides an element using the app's `hidden` class. */
export function setHidden(element: Element, hidden: boolean): void {
  element.classList.toggle('hidden', hidden);
}

/**
 * Attaches one listener to a container and dispatches by the nearest ancestor
 * carrying `data-<key>`.
 *
 * Replaces per-row `onclick` closures. The old renderer created a fresh
 * closure for every row on every render — 125 assignment sites, re-run on each
 * refresh — which allocated garbage proportional to list length and made
 * re-rendering more expensive the more there was to show.
 */
export function delegate<E extends Event = MouseEvent>(
  container: Element,
  eventName: string,
  selector: string,
  handler: (target: HTMLElement, event: E) => void
): void {
  container.addEventListener(eventName, (event) => {
    const origin = event.target;
    if (!(origin instanceof Element)) {
      return;
    }

    const match = origin.closest(selector);
    if (match instanceof HTMLElement && container.contains(match)) {
      handler(match, event as E);
    }
  });
}
