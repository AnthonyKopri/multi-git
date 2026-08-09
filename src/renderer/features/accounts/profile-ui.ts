// The header's SSH Key segment, its dropdown, and the identity row.
import { el, fragment, icon, setHidden } from '../../dom/create';
import { profileColor, segmentTitle } from '../../ui/format';
import { profileIdentity } from './identity';
import type { Elements } from '../../dom/elements';
import type { AppState } from '../../state/store';
import type { AccountRule, ClientSshProfile } from '../../../shared/config-types';

/** Builds one row of the profile dropdown; null means System SSH. */
function buildProfileRow(
  profile: ClientSshProfile | null,
  activeProfileId: string,
  vaultUnlocked: boolean
): HTMLLIElement {
  const id = profile?.id ?? '';
  const isActive = id === activeProfileId;

  const dot = el('span', { className: `profile-dot${profile ? '' : ' profile-dot-system'}` });
  if (profile) {
    dot.style.backgroundColor = profileColor(profile.id);
  }

  // The account's identity is the more useful subtitle; the key path stays in
  // the tooltip so it is still discoverable.
  const identity = profileIdentity(profile);
  const subtitle = identity
    ? `${identity.name} <${identity.email}>`
    : (profile?.privateKeyPath ?? 'Default ssh configuration / agent');
  const subtitleTitle = identity && profile ? `${subtitle} — ${profile.privateKeyPath}` : subtitle;

  const children: HTMLElement[] = [
    dot,
    el('span', {
      className: 'dropdown-item-text',
      children: [
        el('span', { className: 'dropdown-item-main', text: profile?.label ?? 'System SSH' }),
        el('span', { className: 'dropdown-item-sub', text: subtitle, title: subtitleTitle })
      ]
    })
  ];

  if (profile?.hasSavedPassword) {
    const lock = icon(vaultUnlocked ? 'lock_open' : 'lock', 15);
    lock.title = 'Passphrase saved in encrypted vault';
    children.push(lock);
  }

  if (isActive) {
    const check = icon('check');
    check.classList.add('item-check');
    children.push(check);
  }

  return el('li', {
    className: `dropdown-item${isActive ? ' active' : ''}`,
    data: { profileId: id },
    children
  });
}

/** Redraws everything that depends on the active profile or vault state. */
export function renderProfileUI(ui: Elements, state: Readonly<AppState>): void {
  const profile = state.activeProfileId
    ? (state.sshProfiles.find((p) => p.id === state.activeProfileId) ?? null)
    : null;

  const profileLabel = profile?.label ?? 'System SSH';
  ui.profileSegmentName.textContent = profileLabel;
  ui.profileSegment.title = segmentTitle(
    'Switch SSH key profile for this repository',
    profileLabel
  );

  if (profile) {
    ui.profileColorDot.classList.remove('profile-dot-system');
    ui.profileColorDot.style.backgroundColor = profileColor(profile.id);
  } else {
    ui.profileColorDot.classList.add('profile-dot-system');
    ui.profileColorDot.style.backgroundColor = '';
  }

  // Vault glyph beside the profile name, shown only when a passphrase is
  // stored for this profile.
  const vaultIcon = ui.profileVaultIcon;
  vaultIcon.classList.remove('vault-open', 'vault-locked');

  if (profile?.hasSavedPassword) {
    setHidden(vaultIcon, false);
    if (state.vaultStatus.unlocked) {
      vaultIcon.textContent = 'lock_open';
      vaultIcon.classList.add('vault-open');
      vaultIcon.title = 'Saved passphrase available (vault unlocked)';
    } else {
      vaultIcon.textContent = 'lock';
      vaultIcon.classList.add('vault-locked');
      vaultIcon.title = 'Saved passphrase requires unlocking the vault';
    }
  } else {
    setHidden(vaultIcon, true);
  }

  renderVaultChip(ui, state);
  renderProfileDropdown(ui, state);
  renderIdentityRow(ui, state);
}

function renderVaultChip(ui: Elements, state: Readonly<AppState>): void {
  const chip = ui.dropdownVaultStatus;
  chip.classList.remove('vault-open', 'vault-locked');

  if (state.vaultStatus.unlocked) {
    chip.textContent = 'Vault: Unlocked';
    chip.classList.add('vault-open');
    ui.btnDropdownVault.textContent = 'Lock';
    return;
  }

  chip.textContent = state.vaultStatus.hasVault ? 'Vault: Locked' : 'Vault: Not set up';
  if (state.vaultStatus.hasVault) {
    chip.classList.add('vault-locked');
  }
  ui.btnDropdownVault.textContent = 'Unlock';
}

function renderProfileDropdown(ui: Elements, state: Readonly<AppState>): void {
  const rows = [
    // System SSH always leads the list.
    buildProfileRow(null, state.activeProfileId, state.vaultStatus.unlocked),
    ...state.sshProfiles.map((profile) =>
      buildProfileRow(profile, state.activeProfileId, state.vaultStatus.unlocked)
    )
  ];

  ui.profileDropdownList.replaceChildren(fragment(rows));
}

export function renderIdentityRow(ui: Elements, state: Readonly<AppState>): void {
  const identity = state.identity;

  if (identity && (identity.name || identity.email)) {
    const scope = identity.isLocal ? 'repo' : 'global';
    const text = `${identity.name || '(no name)'} <${identity.email || 'no email'}> · ${scope}`;
    ui.identityText.textContent = text;
    ui.identityText.title = text;
    return;
  }

  ui.identityText.textContent = state.activeRepo
    ? 'Commit identity: not set'
    : 'Commit identity: —';
}

/** One row of the auto-select rules list. */
function buildRuleRow(rule: AccountRule, profiles: readonly ClientSshProfile[]): HTMLLIElement {
  const profile = profiles.find((candidate) => candidate.id === rule.profileId);

  const account = el('span', { className: 'rule-account' });
  if (profile) {
    const dot = el('span', { className: 'profile-dot' });
    dot.style.backgroundColor = profileColor(profile.id);
    account.append(dot, document.createTextNode(profile.label));
  } else {
    // The profile was deleted but the rule survived; say so rather than
    // rendering a blank row.
    account.textContent = '(deleted account)';
  }

  return el('li', {
    className: 'rule-item',
    children: [
      el('span', { className: 'rule-match', text: rule.match, title: rule.match }),
      icon('arrow_forward', 15),
      account,
      el('button', {
        className: 'btn btn-icon btn-sm rule-delete-btn',
        title: 'Delete rule',
        data: { action: 'delete-rule', ruleId: rule.id },
        children: [icon('delete', 14)]
      })
    ]
  });
}

export function renderAccountRules(ui: Elements, state: Readonly<AppState>): void {
  // Account choices offered when adding a rule.
  const options =
    state.sshProfiles.length === 0
      ? [el('option', { text: 'No accounts yet' })]
      : state.sshProfiles.map((profile) => {
          const option = el('option', { text: profile.label });
          option.value = profile.id;
          return option;
        });

  ui.ruleProfileSelect.replaceChildren(fragment(options));

  ui.accountRulesList.replaceChildren(
    state.accountRules.length === 0
      ? el('li', { className: 'empty-state', text: 'No auto-select rules' })
      : fragment(state.accountRules.map((rule) => buildRuleRow(rule, state.sshProfiles)))
  );
}
