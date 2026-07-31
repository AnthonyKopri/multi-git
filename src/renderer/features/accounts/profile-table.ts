// The SSH Profile Manager's table of registered profiles.
import { el, fragment, icon } from '../../dom/create';
import { profileColor } from '../../ui/format';
import { profileIdentity } from './identity';
import type { ClientSshProfile } from '../../../shared/config-types';

/** Row actions, dispatched by the table's delegated listener. */
const ACTIONS: { action: string; glyph: string; title: string; className: string }[] = [
  { action: 'edit', glyph: 'edit', title: 'Edit profile', className: 'btn btn-secondary btn-sm' },
  { action: 'test', glyph: 'fact_check', title: 'Test SSH key', className: 'btn btn-secondary btn-sm' },
  { action: 'copy-key', glyph: 'content_copy', title: 'Copy public key', className: 'btn btn-secondary btn-sm' },
  { action: 'copy-path', glyph: 'link', title: 'Copy public key path', className: 'btn btn-secondary btn-sm' },
  { action: 'open-folder', glyph: 'folder_open', title: 'Open key folder', className: 'btn btn-secondary btn-sm' },
  { action: 'delete', glyph: 'delete', title: 'Delete SSH profile', className: 'btn btn-danger btn-sm' }
];

function buildRow(profile: ClientSshProfile): HTMLTableRowElement {
  const dot = el('span', { className: 'profile-dot' });
  dot.style.display = 'inline-block';
  dot.style.marginRight = '6px';
  dot.style.verticalAlign = 'middle';
  dot.style.backgroundColor = profileColor(profile.id);

  const nameCell = el('td', { className: 'col-profile-name' });
  nameCell.append(dot, document.createTextNode(profile.label));

  const identity = profileIdentity(profile);
  if (identity) {
    const line = el('div', { text: `${identity.name} <${identity.email}>` });
    line.title = line.textContent ?? '';
    line.style.fontSize = '0.6875rem';
    line.style.color = 'var(--text-dim)';
    line.style.overflow = 'hidden';
    line.style.textOverflow = 'ellipsis';
    nameCell.appendChild(line);
  }

  const actions = el('td', {
    className: 'action-buttons',
    children: ACTIONS.map((spec) => {
      const button = el('button', {
        className: spec.className,
        title: spec.title,
        // Buttons live inside a form-bearing modal, so an unset type would
        // default to submit and reload the dialog.
        attrs: { type: 'button' },
        data: { action: spec.action, profileId: profile.id },
        children: [icon(spec.glyph, 16)]
      });
      return button;
    })
  });

  return el('tr', {
    data: { profileId: profile.id },
    children: [
      nameCell,
      el('td', {
        className: 'col-key-path',
        text: profile.privateKeyPath,
        title: profile.privateKeyPath
      }),
      el('td', {
        className: 'col-password',
        text: profile.hasSavedPassword ? 'Saved' : 'Not saved',
        title: profile.hasSavedPassword
          ? 'Encrypted passphrase saved in vault'
          : 'No passphrase stored'
      }),
      actions
    ]
  });
}

export function renderProfileTable(body: Element, profiles: readonly ClientSshProfile[]): void {
  if (profiles.length === 0) {
    const cell = el('td', { className: 'text-center', text: 'No registered profiles.' });
    cell.colSpan = 4;
    cell.style.textAlign = 'center';
    cell.style.color = 'var(--text-dim)';
    body.replaceChildren(el('tr', { children: [cell] }));
    return;
  }

  body.replaceChildren(fragment(profiles.map(buildRow)));
}
