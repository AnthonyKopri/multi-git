// The vault status card in the SSH Profile Manager, and the welcome overlay's
// key-setup row.
import { setHidden } from '../../dom/create';
import type { Elements } from '../../dom/elements';
import type { AppState } from '../../state/store';
import type { VaultStatus } from '../../../shared/config-types';

type VaultState = 'uninitialized' | 'locked' | 'unlocked';

interface VaultPresentation {
  state: VaultState;
  title: string;
  detail: string;
  glyph: string;
}

function describeVault(status: VaultStatus): VaultPresentation {
  if (status.unlocked) {
    return {
      state: 'unlocked',
      title: 'Passphrase vault is unlocked',
      detail:
        'Saved passphrases can be used and new ones can be encrypted for this app session. Lock it when you are finished.',
      glyph: 'lock_open'
    };
  }

  if (status.hasVault) {
    return {
      state: 'locked',
      title: 'Passphrase vault is locked',
      detail:
        'Saved passphrases stay encrypted on disk. Unlock the vault before using or saving a passphrase.',
      glyph: 'lock'
    };
  }

  return {
    state: 'uninitialized',
    title: 'Passphrase vault is not set up',
    detail:
      'A vault is optional. Set one up only if you want Multi-Git to save SSH passphrases on this computer.',
    glyph: 'lock'
  };
}

export function renderVaultStatus(ui: Elements, status: VaultStatus): void {
  const { state, title, detail, glyph } = describeVault(status);

  ui.vaultStatusCard.dataset['vaultState'] = state;
  ui.vaultStatusText.textContent = title;
  ui.vaultStatusDetail.textContent = detail;
  ui.vaultStatusIcon.textContent = glyph;

  // Exactly one action is meaningful in each state.
  setHidden(ui.btnSetupVault, state !== 'uninitialized');
  setHidden(ui.btnUnlockVault, state !== 'locked');
  setHidden(ui.btnLockVault, state !== 'unlocked');
}

/**
 * The welcome overlay's key-setup row.
 *
 * The overlay covers the whole window including the header that normally
 * leads to the SSH manager, so on a fresh machine with no repositories there
 * was no route to adding a key. The overlay carries its own entry point.
 */
export function renderOverlaySshStatus(ui: Elements, state: Readonly<AppState>): void {
  const count = state.sshProfiles.length;
  const ready = count > 0;

  ui.overlaySshRow.dataset['sshState'] = ready ? 'ready' : 'empty';
  ui.overlaySshTitle.textContent = ready
    ? `${count} SSH key profile${count === 1 ? '' : 's'} ready`
    : 'No SSH keys set up yet';
  ui.overlaySshDetail.textContent = ready
    ? 'Add another key or edit the existing ones before cloning over SSH.'
    : 'Generate or add a key here first — cloning and pushing over SSH need one.';
  ui.overlaySshBtnLabel.textContent = ready ? 'Manage Keys' : 'Set Up Keys';
}
