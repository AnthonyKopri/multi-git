// Sets the theme, and reduced colour, before the first paint.
//
// Loaded as a plain script in <head>, ahead of the stylesheet: the bundle is at
// the bottom of the page and runs after the first frame, so applying the theme
// from there opened every light-theme window dark and then flipped it.
//
// The setting itself lives in the app's config file, which needs a request to
// read. What is read here is the copy the renderer left in localStorage the
// last time it applied one (see src/renderer/ui/appearance.ts). On a profile
// that has never opened the app there is no copy, and the default is dark in
// full colour.
(function () {
  var choice = 'dark';
  var color = 'full';
  try {
    choice = window.localStorage.getItem('mg_theme') || 'dark';
    color = window.localStorage.getItem('mg_color') || 'full';
  } catch (error) {
    // Storage can be blocked; the defaults stand.
  }

  var theme = 'dark';
  if (choice === 'light' || choice === 'oled') {
    theme = choice;
  } else if (
    choice === 'system' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: light)').matches
  ) {
    theme = 'light';
  }

  document.documentElement.setAttribute('data-theme', theme);
  if (color === 'reduced') {
    document.documentElement.setAttribute('data-color', 'reduced');
  }
})();
