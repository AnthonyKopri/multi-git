// The "what counts as stale" control, and the sentence that reads it back.
//
// Two windows edit this one setting: the Maintenance tab, where the rules
// decide what the list below them contains, and Settings, where they sit with
// the rest of the app's preferences. Two copies of a form over one setting is
// two chances for them to disagree about what the setting means, so there is
// one builder and each caller supplies what to do when it changes.
//
// The sentence is not decoration. Three checkboxes and a match mode can be
// combined into a rule nobody can read off the controls — "no pull request or
// unpushed" and "no pull request and unpushed" look almost identical and list
// wildly different things — so the form says what it currently means in words.
import { el } from '../../dom/create';
import { MAX_INACTIVE_DAYS, MIN_INACTIVE_DAYS } from '../../../shared/maintenance-types';
import type { StaleRules } from '../../../shared/maintenance-types';

export interface RulesFormOptions {
  rules: StaleRules;
  /** Called with the whole rule set whenever any part of it changes. */
  onChange: (next: StaleRules) => void;
}

/** The plain-English version of a rule set. */
export function staleRuleSentence(rules: StaleRules): string {
  const parts: string[] = [];

  if (rules.requireNoPullRequest) {
    parts.push('no pull request was ever opened for it');
  }
  if (rules.requireUnpushed) {
    parts.push('no remote has a copy of it');
  }
  if (rules.requireInactive) {
    parts.push(`nothing has landed on it for ${rules.inactiveDays} days`);
  }

  if (parts.length === 0) {
    return 'Nothing counts as stale while every rule is switched off.';
  }
  if (parts.length === 1) {
    return `A branch is stale when ${parts[0] as string}.`;
  }

  const joiner = rules.match === 'any' ? 'or' : 'and';
  const last = parts[parts.length - 1] as string;

  return `A branch is stale when ${parts.slice(0, -1).join(', ')} ${joiner} ${last}.`;
}

function checkbox(checked: boolean, label: string, onChange: (value: boolean) => void): HTMLInputElement {
  const box = el('input', { className: 'branch-select' }) as HTMLInputElement;
  box.type = 'checkbox';
  box.checked = checked;
  box.setAttribute('aria-label', label);
  box.addEventListener('change', () => onChange(box.checked));
  return box;
}

function buildDaysInput(options: RulesFormOptions): HTMLInputElement {
  const { rules } = options;

  const days = el('input', {
    className: 'stale-days',
    attrs: { type: 'number', min: String(MIN_INACTIVE_DAYS), max: String(MAX_INACTIVE_DAYS) }
  }) as HTMLInputElement;

  days.value = String(rules.inactiveDays);
  days.disabled = !rules.requireInactive;
  days.setAttribute('aria-label', 'Days without a commit');

  // `change` rather than `input`: the Maintenance tab surveys the repository on
  // every change, and that would be one pass of git per digit of "120".
  days.addEventListener('change', () => {
    const parsed = Number.parseInt(days.value, 10);
    // Clamped here as well as on the server, so the field shows what was
    // actually stored rather than what was typed.
    const clamped = Number.isFinite(parsed)
      ? Math.min(Math.max(parsed, MIN_INACTIVE_DAYS), MAX_INACTIVE_DAYS)
      : rules.inactiveDays;

    days.value = String(clamped);
    options.onChange({ ...rules, inactiveDays: clamped });
  });

  return days;
}

export function buildMatchSelect(options: RulesFormOptions): HTMLSelectElement {
  const { rules } = options;

  const match = el('select', { className: 'stale-match' }) as HTMLSelectElement;
  match.setAttribute('aria-label', 'How the ticked rules combine');

  for (const [value, label] of [
    ['all', 'must all be true'],
    ['any', 'any one is enough']
  ] as const) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    match.appendChild(option);
  }

  match.value = rules.match;
  match.addEventListener('change', () => {
    options.onChange({ ...rules, match: match.value === 'any' ? 'any' : 'all' });
  });

  return match;
}

/** The three switches, the day count, and the sentence they add up to. */
export function buildStaleRulesForm(options: RulesFormOptions): HTMLElement {
  const { rules } = options;

  const row = (label: string, checked: boolean, onChange: (value: boolean) => void, extra: Node[] = []) =>
    el('label', {
      className: 'checkbox-row',
      children: [checkbox(checked, label, onChange), el('span', { text: label }), ...extra]
    });

  return el('div', {
    className: 'maintenance-rules-form',
    children: [
      el('div', {
        className: 'maintenance-rules',
        children: [
          row('No pull request was ever opened', rules.requireNoPullRequest, (value) => {
            options.onChange({ ...rules, requireNoPullRequest: value });
          }),
          row('No remote has a copy of it', rules.requireUnpushed, (value) => {
            options.onChange({ ...rules, requireUnpushed: value });
          }),
          row(
            'Nothing has landed for',
            rules.requireInactive,
            (value) => {
              options.onChange({ ...rules, requireInactive: value });
            },
            [buildDaysInput(options), el('span', { text: 'days' })]
          )
        ]
      }),
      el('p', { className: 'modal-desc', text: staleRuleSentence(rules) })
    ]
  });
}
