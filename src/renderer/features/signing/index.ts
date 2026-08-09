// Signing: what this repository signs with, and what a commit's signature
// actually says.
//
// The badge wording is the point of this file. "Verified" is a strong claim,
// and it is only made when git verified it against a key this repository
// trusts. Everything else says what is actually known, which for the common
// case of "signed, but no allowed-signers file" is that it cannot be checked
// here — not that it is unsigned.
import * as api from '../../api/endpoints';
import { errorMessage, isStale } from '../../api/client';
import type { Elements } from '../../dom/elements';
import { asInput, asSelect } from '../../dom/elements';
import { el, fragment, setHidden } from '../../dom/create';
import { showToast } from '../../ui/toast';
import { logToTerminal } from '../../ui/log';
import type { SignatureInfo, SigningConfig, SigningMode } from '../../../shared/signing-types';

interface BadgeLook {
  label: string;
  className: string;
}

const BADGE: Record<SignatureInfo['status'], BadgeLook> = {
  good: { label: 'Verified', className: 'badge signature-badge signature-good' },
  bad: { label: 'Bad signature', className: 'badge signature-badge signature-bad' },
  unknown: { label: 'Unverified', className: 'badge signature-badge signature-unknown' },
  unsigned: { label: 'Unsigned', className: 'badge signature-badge signature-unsigned' }
};

let ui: Elements;
let candidates: { profileId: string; label: string; publicKeyPath: string }[] = [];

/**
 * What the repository would do without being asked.
 *
 * Kept here rather than passed in by the commit box, so the box does not have
 * to know the difference between "the user ticked Sign" and "the repository
 * signs everything anyway" — a distinction that decides whether a flag is
 * worth sending at all.
 */
let signsByDefault = false;

export function initSigning(elements: Elements): void {
  ui = elements;
}

/** Shows a commit's signature, or hides the badge for an unsigned one. */
export async function showCommitSignature(hash: string): Promise<void> {
  setHidden(ui.drawerSignature, true);

  try {
    const { signature } = await api.getCommitSignature(hash);

    // An unsigned commit is the overwhelming majority; a badge saying so on
    // every one of them is noise rather than information.
    if (signature.status === 'unsigned') {
      return;
    }

    const look = BADGE[signature.status];
    ui.drawerSignature.className = look.className;
    ui.drawerSignature.textContent =
      signature.signer === null ? look.label : `${look.label} · ${signature.signer}`;
    ui.drawerSignature.title = [
      signature.reason,
      signature.kind === 'unknown' ? null : `${signature.kind.toUpperCase()} signature`,
      signature.fingerprint
    ]
      .filter((part) => part !== null && part !== '')
      .join('\n');

    setHidden(ui.drawerSignature, false);
  } catch (error) {
    if (!isStale(error)) {
      logToTerminal(`Could not read the signature: ${errorMessage(error)}`, 'error');
    }
  }
}

function renderDiagnostics(
  diagnostics: readonly { code: string; message: string; blocksSigning: boolean }[]
): void {
  setHidden(ui.signingDiagnostics, diagnostics.length === 0);

  ui.signingDiagnostics.replaceChildren(
    fragment(
      diagnostics.map((entry) =>
        el('li', {
          className: 'recovery-item',
          children: [
            el('div', {
              className: 'recovery-item-main',
              children: [
                el('span', { className: 'recovery-label', text: entry.message }),
                el('span', {
                  className: 'recovery-meta',
                  text: entry.blocksSigning ? 'stops signing' : 'stops verification only'
                })
              ]
            })
          ]
        })
      )
    )
  );
}

/** SSH mode needs a key path and an allowed-signers file; GPG needs neither. */
function applyModeVisibility(mode: SigningMode): void {
  setHidden(ui.signingKeyGroup, mode === 'system' || mode === 'off');
  setHidden(ui.signingAllowedGroup, mode !== 'ssh');
  setHidden(ui.signingKeyPicker, mode !== 'ssh');
}

function fillForm(config: SigningConfig): void {
  asSelect(ui.signingMode).value = config.mode;
  asInput(ui.signingKey).value = config.signingKey ?? '';
  asInput(ui.signingAllowedSigners).value = config.allowedSignersFile ?? '';
  asInput(ui.signingDefaultCommits).checked = config.signCommitsByDefault;
  asInput(ui.signingDefaultTags).checked = config.signTagsByDefault;

  applyModeVisibility(config.mode);
}

function fillKeyPicker(): void {
  const picker = ui.signingKeyPicker as HTMLSelectElement;
  picker.replaceChildren(
    el('option', { text: candidates.length === 0 ? 'No registered SSH profiles' : 'Use a registered key…' }),
    fragment(
      candidates.map((candidate) => {
        const option = el('option', { text: candidate.label });
        (option as HTMLOptionElement).value = candidate.publicKeyPath;
        return option;
      })
    )
  );
  picker.selectedIndex = 0;
}

export async function openSigningSettings(): Promise<void> {
  try {
    const status = await api.getSigningStatus();
    candidates = status.sshSigningCandidates;

    fillForm(status.config);
    fillKeyPicker();
    renderDiagnostics(status.diagnostics);

    setHidden(ui.signingModal, false);
  } catch (error) {
    if (!isStale(error)) {
      showToast(errorMessage(error, 'Could not read the signing settings.'), 'error');
    }
  }
}

export function closeSigningSettings(): void {
  setHidden(ui.signingModal, true);
}

async function save(): Promise<void> {
  const mode = asSelect(ui.signingMode).value as SigningMode;
  const key = asInput(ui.signingKey).value.trim();
  const allowed = asInput(ui.signingAllowedSigners).value.trim();

  try {
    const status = await api.saveSigningConfig({
      mode,
      // An empty field means "clear it", which is a different intention from
      // leaving it alone, so it is sent as an explicit null.
      signingKey: key === '' ? null : key,
      allowedSignersFile: allowed === '' ? null : allowed,
      signCommitsByDefault: asInput(ui.signingDefaultCommits).checked,
      signTagsByDefault: asInput(ui.signingDefaultTags).checked
    });

    renderDiagnostics(status.diagnostics);
    fillForm(status.config);

    const blocking = status.diagnostics.filter((entry) => entry.blocksSigning);
    if (blocking.length > 0) {
      showToast(`Saved, but signing will not work yet: ${blocking[0]?.message ?? ''}`, 'error', 9000);
      return;
    }

    showToast('Signing settings saved.', 'success');
    await refreshCommitSignControl();
    closeSigningSettings();
  } catch (error) {
    if (!isStale(error)) {
      showToast(errorMessage(error, 'Could not save the signing settings.'), 'error', 7000);
    }
  }
}

/**
 * Puts the Sign checkbox in step with the repository.
 *
 * Checked and disabled when the repository signs everything: the box then
 * describes what will happen rather than offering a choice that the setting
 * has already made.
 */
export async function refreshCommitSignControl(): Promise<void> {
  try {
    const { config } = await api.getSigningStatus();
    const box = asInput(ui.commitSignCheckbox);

    signsByDefault = config.signCommitsByDefault;
    box.checked = config.signCommitsByDefault;
    box.disabled = config.mode === 'off';
    ui.commitSignRow.title =
      config.mode === 'off'
        ? 'Signing is switched off for this repository'
        : config.signCommitsByDefault
          ? 'This repository signs every commit'
          : 'Sign this commit';
  } catch (error) {
    if (!isStale(error)) {
      // Not knowing is not worth an error; the checkbox simply stays as it is.
    }
  }
}

/**
 * Whether the next commit should be signed, or undefined to let git decide.
 *
 * Sending nothing when the box matches the repository's own setting keeps the
 * commit command identical to what a terminal would run, which is what makes
 * the Terminal Log worth reading.
 */
export function commitSignPreference(): boolean | undefined {
  const checked = asInput(ui.commitSignCheckbox).checked;
  return checked === signsByDefault ? undefined : checked;
}

export function wireSigning(): void {
  ui.btnSigningSettings.addEventListener('click', (event) => {
    // The control lives inside a label, which would otherwise toggle the box.
    event.preventDefault();
    void openSigningSettings();
  });
  ui.btnCloseSigningModal.addEventListener('click', () => closeSigningSettings());
  ui.btnCancelSigning.addEventListener('click', () => closeSigningSettings());

  ui.signingMode.addEventListener('change', () => {
    applyModeVisibility(asSelect(ui.signingMode).value as SigningMode);
  });

  ui.signingKeyPicker.addEventListener('change', () => {
    const chosen = (ui.signingKeyPicker as HTMLSelectElement).value;
    if (chosen !== '') {
      asInput(ui.signingKey).value = chosen;
    }
  });

  ui.signingForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void save();
  });
}
