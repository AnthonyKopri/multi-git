// Turning a vertical wheel into horizontal scrolling.
//
// A few rows in this app scroll sideways rather than wrapping — the commit
// template chips, and the Repository hub's tab strip. A browser only scrolls
// those from a wheel that reports horizontal movement, which means shift-wheel
// or a tilt wheel or a trackpad. On an ordinary mouse the row simply refuses to
// move, and the chips past the edge are unreachable without dragging the panel
// wider.
//
// So a plain vertical wheel is redirected here — but only while the row can
// still move in that direction. At either end the event is left alone, so the
// wheel goes back to scrolling whatever the row sits inside instead of the
// gesture dying on a strip that has nothing left to give.

/** How close to an edge still counts as being at it, in pixels. */
const EDGE_EPSILON = 1;

function maxScrollLeft(element: HTMLElement): number {
  return element.scrollWidth - element.clientWidth;
}

function canScrollBy(element: HTMLElement, delta: number): boolean {
  const limit = maxScrollLeft(element);

  if (limit <= EDGE_EPSILON) {
    return false;
  }
  if (delta < 0) {
    return element.scrollLeft > EDGE_EPSILON;
  }
  if (delta > 0) {
    return element.scrollLeft < limit - EDGE_EPSILON;
  }

  return false;
}

/**
 * Reflects how much of the row is out of view, for the edge fades.
 *
 * Exported because the same three classes are worth setting once at render
 * time, before any wheel or scroll event has happened.
 */
export function updateScrollEdges(element: HTMLElement): void {
  const limit = maxScrollLeft(element);
  const overflowing = limit > EDGE_EPSILON;

  element.classList.toggle('is-scrollable', overflowing);
  element.classList.toggle('at-start', !overflowing || element.scrollLeft <= EDGE_EPSILON);
  element.classList.toggle('at-end', !overflowing || element.scrollLeft >= limit - EDGE_EPSILON);
}

/**
 * Lets an ordinary wheel scroll a horizontal strip, and keeps its edge fades
 * current. Returns a disposer.
 */
export function attachHorizontalWheel(element: HTMLElement): () => void {
  const onWheel = (event: WheelEvent): void => {
    // A gesture that already carries horizontal movement is the browser's to
    // handle; intercepting it would double the distance travelled.
    if (event.deltaX !== 0 || event.deltaY === 0) {
      return;
    }
    if (!canScrollBy(element, event.deltaY)) {
      return;
    }

    event.preventDefault();
    element.scrollLeft += event.deltaY;
    updateScrollEdges(element);
  };

  const onScroll = (): void => updateScrollEdges(element);

  // Not passive: the whole point is to be able to preventDefault.
  element.addEventListener('wheel', onWheel, { passive: false });
  element.addEventListener('scroll', onScroll);
  updateScrollEdges(element);

  // A strip usually starts wide enough to hold everything and only overflows
  // once a divider is dragged in. That is not a scroll, so without this the
  // fade that says "there is more this way" would not appear until the user
  // had already guessed there was.
  const observer =
    typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => updateScrollEdges(element));
  observer?.observe(element);

  return () => {
    element.removeEventListener('wheel', onWheel);
    element.removeEventListener('scroll', onScroll);
    observer?.disconnect();
  };
}
