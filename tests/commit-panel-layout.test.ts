// @vitest-environment happy-dom
//
// Scrolling a horizontal strip with an ordinary wheel.
//
// The commit template chips scroll sideways and never wrap. A browser moves
// them only for a wheel that reports horizontal movement, so on a plain mouse
// the chips past the edge were unreachable. This redirects a vertical wheel —
// but only while the strip can still move, because a strip that swallows every
// wheel event traps the gesture and stops the panel around it scrolling.
//
// happy-dom does no layout, so scrollWidth and clientWidth are defined here to
// describe the strip the assertions are about.
import { beforeEach, describe, expect, it } from 'vitest';

import { attachHorizontalWheel, updateScrollEdges } from '../src/renderer/ui/wheel-scroll';

interface StripOptions {
  scrollWidth: number;
  clientWidth: number;
  scrollLeft?: number;
}

/** A strip with the given measurements, and a scrollLeft that actually moves. */
function strip({ scrollWidth, clientWidth, scrollLeft = 0 }: StripOptions): HTMLElement {
  const element = document.createElement('div');
  let position = scrollLeft;

  Object.defineProperty(element, 'scrollWidth', { get: () => scrollWidth });
  Object.defineProperty(element, 'clientWidth', { get: () => clientWidth });
  Object.defineProperty(element, 'scrollLeft', {
    get: () => position,
    set: (next: number) => {
      position = Math.min(Math.max(next, 0), scrollWidth - clientWidth);
    }
  });

  document.body.appendChild(element);
  return element;
}

function wheel(element: HTMLElement, deltaY: number, deltaX = 0): WheelEvent {
  const event = new WheelEvent('wheel', { deltaY, deltaX, cancelable: true, bubbles: true });
  element.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('attachHorizontalWheel', () => {
  it('scrolls the strip sideways from a vertical wheel', () => {
    const element = strip({ scrollWidth: 600, clientWidth: 200 });
    attachHorizontalWheel(element);

    const event = wheel(element, 120);

    expect(element.scrollLeft).toBe(120);
    expect(event.defaultPrevented).toBe(true);
  });

  it('scrolls back when the wheel goes the other way', () => {
    const element = strip({ scrollWidth: 600, clientWidth: 200, scrollLeft: 300 });
    attachHorizontalWheel(element);

    wheel(element, -100);

    expect(element.scrollLeft).toBe(200);
  });

  it('releases the wheel at the end so the surrounding panel still scrolls', () => {
    // Already as far right as it goes.
    const element = strip({ scrollWidth: 600, clientWidth: 200, scrollLeft: 400 });
    attachHorizontalWheel(element);

    const event = wheel(element, 120);

    expect(event.defaultPrevented).toBe(false);
    expect(element.scrollLeft).toBe(400);
  });

  it('releases the wheel at the start too', () => {
    const element = strip({ scrollWidth: 600, clientWidth: 200 });
    attachHorizontalWheel(element);

    const event = wheel(element, -120);

    expect(event.defaultPrevented).toBe(false);
    expect(element.scrollLeft).toBe(0);
  });

  it('ignores a strip with nothing to scroll', () => {
    const element = strip({ scrollWidth: 200, clientWidth: 200 });
    attachHorizontalWheel(element);

    const event = wheel(element, 120);

    expect(event.defaultPrevented).toBe(false);
  });

  it('leaves a gesture that is already horizontal to the browser', () => {
    const element = strip({ scrollWidth: 600, clientWidth: 200 });
    attachHorizontalWheel(element);

    // Shift-wheel and trackpads report deltaX; handling those too would move
    // the strip twice as far as the gesture asked for.
    const event = wheel(element, 40, 120);

    expect(event.defaultPrevented).toBe(false);
    expect(element.scrollLeft).toBe(0);
  });

  it('stops listening once disposed', () => {
    const element = strip({ scrollWidth: 600, clientWidth: 200 });
    const dispose = attachHorizontalWheel(element);

    dispose();
    const event = wheel(element, 120);

    expect(event.defaultPrevented).toBe(false);
    expect(element.scrollLeft).toBe(0);
  });
});

describe('updateScrollEdges', () => {
  it('marks a strip that does not overflow as neither scrollable nor mid-scroll', () => {
    const element = strip({ scrollWidth: 200, clientWidth: 200 });

    updateScrollEdges(element);

    expect(element.classList.contains('is-scrollable')).toBe(false);
    expect(element.classList.contains('at-start')).toBe(true);
    expect(element.classList.contains('at-end')).toBe(true);
  });

  it('fades only the edge with more content past it', () => {
    const element = strip({ scrollWidth: 600, clientWidth: 200 });
    updateScrollEdges(element);

    expect(element.classList.contains('is-scrollable')).toBe(true);
    expect(element.classList.contains('at-start')).toBe(true);
    expect(element.classList.contains('at-end')).toBe(false);

    element.scrollLeft = 400;
    updateScrollEdges(element);

    expect(element.classList.contains('at-start')).toBe(false);
    expect(element.classList.contains('at-end')).toBe(true);
  });

  it('follows a scroll the user made by other means', () => {
    const element = strip({ scrollWidth: 600, clientWidth: 200 });
    attachHorizontalWheel(element);

    element.scrollLeft = 150;
    element.dispatchEvent(new Event('scroll'));

    expect(element.classList.contains('at-start')).toBe(false);
    expect(element.classList.contains('at-end')).toBe(false);
  });
});
