// The SSH Profile Manager's table of registered profiles.
//
// Eight icon buttons in a row wrapped onto two lines and read as a wall. The
// split below is by how often a thing is actually needed: editing, checking
// which account a key really is, copying the public key to paste into a host,
// and deleting are the row. Everything else — making an account the machine
// default, validating the key file locally, copying a path, opening a folder —
// is occasional, so it moves behind the overflow rather than competing for
// attention with the four that are not.
import { el, fragment, icon, setHidden } from '../../dom/create';
import { profileColor } from '../../ui/format';
import { profileIdentity } from './identity';
import type { ClientSshProfile } from '../../../shared/config-types';

interface ActionSpec {
  action: string;
  glyph: string;
  title: string;
  className: string;
}

/** Shown on the row itself. */
const ROW_ACTIONS: ActionSpec[] = [
  { action: 'edit', glyph: 'edit', title: 'Edit profile', className: 'btn btn-secondary btn-sm' },
  {
    action: 'verify',
    glyph: 'verified_user',
    title: 'Ask the host which account this key authenticates as',
    className: 'btn btn-secondary btn-sm'
  },
  {
    action: 'copy-key',
    glyph: 'content_copy',
    title: 'Copy public key',
    className: 'btn btn-secondary btn-sm'
  },
  { action: 'delete', glyph: 'delete', title: 'Delete SSH profile', className: 'btn btn-danger btn-sm' }
];

/** Behind the overflow, with labels, because a lone icon there says nothing. */
const MENU_ACTIONS: { action: string; glyph: string; label: string }[] = [
  { action: 'test', glyph: 'fact_check', label: 'Test key file' },
  { action: 'copy-path', glyph: 'link', label: 'Copy public key path' },
  { action: 'open-folder', glyph: 'folder_open', label: 'Open key folder' }
];

/**
 * The default-account toggle, beside the name it applies to.
 *
 * A star rather than a row in the overflow because it is as much a state as an
 * action: filled means this is the account everything without one of its own
 * uses. It stays invisible until the row is hovered, so a table of five
 * profiles shows one star, not five — but the filled one is always visible,
 * since that is the fact worth reading at a glance.
 */
function defaultStar(profileId: string, isDefault: boolean): HTMLElement {
  const label = isDefault
    ? 'Default account — click to clear'
    : 'Make default';

  return el('button', {
    className: `profile-star${isDefault ? ' is-default' : ''}`,
    title: label,
    attrs: { type: 'button', 'aria-pressed': String(isDefault), 'aria-label': label },
    data: { action: 'make-default', profileId },
    children: [icon('star', 16)]
  });
}

function actionButton(spec: ActionSpec, profileId: string): HTMLElement {
  return el('button', {
    className: spec.className,
    title: spec.title,
    // Buttons live inside a form-bearing modal, so an unset type would
    // default to submit and reload the dialog.
    attrs: { type: 'button' },
    data: { action: spec.action, profileId },
    children: [icon(spec.glyph, 16)]
  });
}

function overflowMenu(profileId: string): HTMLElement {
  return el('div', {
    className: 'profile-row-menu hidden',
    data: { rowMenu: profileId },
    children: MENU_ACTIONS.map((spec) =>
      el('button', {
        className: 'btn btn-menu-row',
        attrs: { type: 'button' },
        data: { action: spec.action, profileId },
        children: [icon(spec.glyph, 16), el('span', { text: spec.label })]
      })
    )
  });
}

function buildRow(profile: ClientSshProfile, defaultProfileId: string): HTMLTableRowElement {
  const dot = el('span', { className: 'profile-dot' });
  dot.style.display = 'inline-block';
  dot.style.marginRight = '6px';
  dot.style.verticalAlign = 'middle';
  dot.style.backgroundColor = profileColor(profile.id);

  const nameCell = el('td', { className: 'col-profile-name' });
  nameCell.append(
    defaultStar(profile.id, profile.id === defaultProfileId),
    dot,
    document.createTextNode(profile.label)
  );

  const identity = profileIdentity(profile);
  if (identity) {
    const line = el('div', { text: `${identity.name} <${identity.email}>` });
    line.title = line.textContent ?? '';
    line.style.fontSize = '0.6875rem';
    line.style.color = 'var(--text-dim)';
    line.style.overflow = 'hidden';
    line.style.textOverflow = 'ellipsis';
    nameCell.appendChild(line);
  } else {
    // A profile with no email applies its key and leaves authorship to the
    // global config, which on a two-account machine is routinely the other
    // account. Said here rather than discovered in a commit.
    const line = el('div', { className: 'profile-no-identity', text: 'No commit identity' });
    line.title = 'Repositories using this account will be authored with your global Git identity.';
    nameCell.appendChild(line);
  }

  const actions = el('td', {
    className: 'action-buttons',
    children: [
      ...ROW_ACTIONS.map((spec) => actionButton(spec, profile.id)),
      actionButton(
        {
          action: 'more',
          glyph: 'more_vert',
          title: 'More actions',
          className: 'btn btn-secondary btn-sm'
        },
        profile.id
      ),
      overflowMenu(profile.id)
    ]
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

/**
 * Opens one row's overflow and closes the others.
 *
 * Pass null to close them all, which is what any other action in the table
 * does — a menu left hanging over the row below it is worse than one that
 * closes eagerly.
 *
 * Positioned as `fixed` against the button rather than absolutely inside the
 * cell: the cell is `overflow: hidden` for its ellipsis and the table sits in a
 * scrolling wrapper, so an absolutely-positioned menu is laid out correctly and
 * then clipped out of existence by both.
 */
export function toggleRowMenu(
  body: Element,
  profileId: string | null,
  trigger?: HTMLElement
): void {
  for (const menu of body.querySelectorAll<HTMLElement>('[data-row-menu]')) {
    const isTarget = menu.dataset['rowMenu'] === profileId;
    const wasOpen = !menu.classList.contains('hidden');
    const open = isTarget && !wasOpen;

    setHidden(menu, !open);

    if (open && trigger) {
      // Measured after unhiding, because a hidden element has no width to
      // right-align against.
      const anchor = trigger.getBoundingClientRect();
      const width = menu.offsetWidth;

      menu.style.top = `${Math.round(anchor.bottom + 4)}px`;
      menu.style.left = `${Math.round(Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8)))}px`;
    }
  }
}

export function renderProfileTable(
  body: Element,
  profiles: readonly ClientSshProfile[],
  defaultProfileId = ''
): void {
  if (profiles.length === 0) {
    const cell = el('td', { className: 'text-center', text: 'No registered profiles.' });
    cell.colSpan = 4;
    cell.style.textAlign = 'center';
    cell.style.color = 'var(--text-dim)';
    body.replaceChildren(el('tr', { children: [cell] }));
    return;
  }

  body.replaceChildren(fragment(profiles.map((profile) => buildRow(profile, defaultProfileId))));
}
