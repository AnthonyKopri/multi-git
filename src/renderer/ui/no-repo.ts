// The one place that says "there is no repository open".
//
// Three features raise this, and each of them knows what the user should do
// next -- so the toast carries the folder picker rather than naming it. Kept
// out of features/repo to avoid a cycle: repo imports the toast layer, and the
// picker is reached lazily here for the same reason.
import { showToast } from './toast';

export function warnNoRepo(what: string): void {
  showToast(`Open a repository first to ${what}.`, 'warn', 7000, {
    label: 'Open…',
    run: () => {
      void import('../features/repo').then((repo) => repo.browseAndOpen());
    }
  });
}
