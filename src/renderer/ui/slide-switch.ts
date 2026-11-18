// A row of buttons in one pill, with a highlight that slides to the chosen one.
//
// The buttons keep their own `active` class, set by whichever feature owns
// them; this only watches that class and moves the highlight under it. So the
// switch needs no wiring into the code that changes views, and keyboard
// shortcuts, menus and the buttons themselves all move it the same way.
//
// The highlight's place comes from the chosen button's own box, read again
// whenever any button changes size: labels hide in a narrow column, and fonts
// arriving after the first paint widen them.

/** Where the highlight sits: the chosen button's offset and width, in pixels. */
export function thumbPlacement(button: { offsetLeft: number; offsetWidth: number } | null): {
  x: number;
  width: number;
} {
  return button ? { x: button.offsetLeft, width: button.offsetWidth } : { x: 0, width: 0 };
}

export function initSlideSwitch(container: HTMLElement): void {
  const thumb = container.querySelector<HTMLElement>('.slide-switch-thumb');
  const buttons = [...container.querySelectorAll<HTMLElement>('button')];
  if (!thumb || buttons.length === 0) {
    return;
  }

  const place = (): void => {
    const { x, width } = thumbPlacement(buttons.find((button) => button.classList.contains('active')) ?? null);
    container.style.setProperty('--thumb-x', `${x}px`);
    container.style.setProperty('--thumb-w', `${width}px`);
  };

  place();
  // The first placement is drawn where it lands; only later moves slide.
  requestAnimationFrame(() => container.classList.add('ready'));

  const classes = new MutationObserver(place);
  for (const button of buttons) {
    classes.observe(button, { attributes: true, attributeFilter: ['class'] });
  }

  if (typeof ResizeObserver === 'function') {
    const sizes = new ResizeObserver(place);
    for (const button of buttons) {
      sizes.observe(button);
    }
  }
}
