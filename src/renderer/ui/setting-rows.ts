// The building blocks of a settings page: cards of rows, each row a label and
// description on the left and its control on the right.
//
// Shared by the Settings window and the Repository window, so a switch or a
// row looks and behaves the same wherever a preference lives. The control is
// never inline with the prose, so the eye can run down the right-hand edge and
// see every switch and button on the page without reading a sentence.
import { el, icon } from '../dom/create';

/** An on/off switch, drawn over a real checkbox so it keeps its keyboard handling. */
export function switchInput(label: string, checked: boolean, onChange: (value: boolean) => void): HTMLInputElement {
  const box = el('input', { className: 'settings-switch' }) as HTMLInputElement;
  box.type = 'checkbox';
  box.checked = checked;
  box.setAttribute('role', 'switch');
  box.setAttribute('aria-label', label);
  box.addEventListener('change', () => onChange(box.checked));
  return box;
}

export interface SettingItemOptions {
  label: string;
  description?: string;
  control?: Node | null;
  /** The control goes under the text at full width, for paths and addresses. */
  stacked?: boolean;
}

/**
 * One setting.
 *
 * A row whose control is a switch is a <label>, so the whole row toggles
 * rather than only the 44 pixels of the switch.
 */
export function settingItem({ label, description, control, stacked = false }: SettingItemOptions): HTMLElement {
  return el(control instanceof HTMLInputElement && control.type === 'checkbox' ? 'label' : 'div', {
    className: stacked ? 'settings-item settings-item-stacked' : 'settings-item',
    children: [
      el('div', {
        className: 'settings-item-text',
        children: [
          el('span', { className: 'settings-item-label', text: label }),
          description === undefined ? null : el('span', { className: 'settings-item-desc', text: description })
        ]
      }),
      control === undefined || control === null
        ? null
        : el('div', { className: 'settings-item-control', children: [control] })
    ]
  });
}

/** A card of rows, with a rule between each. */
export function settingGroup(children: (Node | null)[]): HTMLElement {
  return el('div', {
    className: 'settings-group',
    children: children.filter((child): child is Node => child !== null)
  });
}

/** A fact about a setting that is not a control, set apart inside its card. */
export function settingNote(iconName: string, text: string): HTMLElement {
  return el('div', {
    className: 'settings-note',
    children: [icon(iconName, 16), el('span', { text })]
  });
}

/** The icon, title and one-line summary above a section's cards. */
export function sectionHeading(iconName: string, title: string, subtitle: string, id?: string): HTMLElement {
  return el('header', {
    className: 'settings-section-header',
    children: [
      el('span', { className: 'settings-section-icon', children: [icon(iconName, 20)] }),
      el('div', {
        children: [
          el('h3', { text: title, attrs: id === undefined ? {} : { id } }),
          subtitle === '' ? null : el('p', { className: 'settings-section-subtitle', text: subtitle })
        ]
      })
    ]
  });
}
