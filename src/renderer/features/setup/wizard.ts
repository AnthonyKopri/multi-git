// The first-run guide: three short screens on the welcome card.
//
//   1. How much of the app do you want on screen?   → Simple mode, or not.
//   2. Is this computer ready?                       → Git, and the SSH agent.
//   3. Your key for GitHub.                          → make it, copy it, check it.
//
// Each screen asks for one thing. Nothing here is the only way to do it: every
// step can be skipped, and the full SSH manager and Settings are where the
// options that were left off these screens live.
//
// The key screen is built around the part people get stuck on. Making a key is
// one click; the stuck part is that the key then has to be pasted into a web
// page, and nothing tells you whether that worked. So the public key goes onto
// the clipboard as soon as it exists, the button to copy it again is the
// biggest thing on the screen, the three steps on GitHub are spelled out, and
// "Validate key" asks GitHub who it thinks you are and says the name back.
import * as api from '../../api/endpoints';
import { errorMessage } from '../../api/client';
import { asButton, asInput } from '../../dom/elements';
import type { Elements } from '../../dom/elements';
import { el, icon, setHidden } from '../../dom/create';
import { getState } from '../../state/store';
import { withButtonBusy } from '../../ui/busy';
import { applyConfigSnapshot } from '../accounts';
import { agentState, refreshAgent, startAgent } from '../accounts/agent';
import { describeAgentForSetup, describeValidation } from './wizard-text';
import { prerequisiteRow, prerequisites, refreshPrerequisites } from './index';
import type { SshAgentState } from '../../../shared/ssh-agent-types';

type Step = 'look' | 'check' | 'key';
const STEPS: readonly Step[] = ['look', 'check', 'key'];

/** Where a new key is added on GitHub. Opens with the form already showing. */
const GITHUB_NEW_KEY_URL = 'https://github.com/settings/ssh/new';

let ui: Elements;
let openSshManager: () => void = () => {};

/** The profile the key screen is about: the one just made, or one already here. */
let profileId: string | null = null;
let publicKey = '';

export function initWizard(elements: Elements, hooks: { openSshManager: () => void }): void {
  ui = elements;
  openSshManager = hooks.openSshManager;

  for (const choice of ui.setupWizard.querySelectorAll<HTMLElement>('[data-wizard-look]')) {
    choice.addEventListener('click', () => void chooseLook(choice.dataset['wizardLook'] === 'simple'));
  }

  ui.btnWizardSkip.addEventListener('click', () => void finishWizard());
  ui.btnWizardCheckBack.addEventListener('click', () => showStep('look'));
  ui.btnWizardRecheck.addEventListener('click', () => {
    void withButtonBusy(ui.btnWizardRecheck, () => renderCheck());
  });
  ui.btnWizardCheckNext.addEventListener('click', () => showStep('key'));

  ui.wizardKeyForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void createKey();
  });
  ui.btnWizardCopyKey.addEventListener('click', () => void copyKey(true));
  ui.btnWizardOpenGithub.addEventListener('click', () => {
    window.open(GITHUB_NEW_KEY_URL, '_blank', 'noopener,noreferrer');
  });
  ui.btnWizardValidateKey.addEventListener('click', () => {
    void withButtonBusy(ui.btnWizardValidateKey, () => validateKey());
  });
  ui.btnWizardKeyBack.addEventListener('click', () => showStep('check'));
  ui.btnWizardExistingKey.addEventListener('click', () => {
    // The manager covers everything this screen leaves out: a key that is
    // already on disk, a passphrase, a second account.
    void finishWizard().then(() => openSshManager());
  });
  ui.btnWizardFinish.addEventListener('click', () => void finishWizard());
}

/** Whether the guide is on screen. */
export function wizardIsOpen(): boolean {
  return !ui.setupWizard.classList.contains('hidden');
}

/** Shows the guide once, the first time this build is opened. */
export function maybeStartWizard(experienceChosen: boolean): void {
  if (!experienceChosen) {
    startWizard();
  }
}

/** Opens the guide from the start. Also reachable from Settings at any time. */
export function startWizard(): void {
  profileId = null;
  publicKey = '';

  // The guide lives on the welcome card, which may be hidden behind an open
  // repository when this is started from Settings.
  setHidden(ui.noRepoOverlay, false);
  setHidden(ui.welcomeHome, true);
  setHidden(ui.setupWizard, false);
  showStep('look');
}

function showStep(step: Step): void {
  for (const section of ui.setupWizard.querySelectorAll<HTMLElement>('[data-wizard-step]')) {
    setHidden(section, section.dataset['wizardStep'] !== step);
  }

  const index = STEPS.indexOf(step);
  for (const [position, dot] of [...ui.setupWizard.querySelectorAll<HTMLElement>('.wizard-dot')].entries()) {
    dot.classList.toggle('is-done', position < index);
    dot.classList.toggle('is-current', position === index);
  }

  if (step === 'check') {
    void renderCheck();
  } else if (step === 'key') {
    void renderKey();
  }
}

// ---------- 1. how it looks ----------

async function chooseLook(simple: boolean): Promise<void> {
  try {
    const { config } = await api.saveAppSettings({ simpleMode: simple });
    applyConfigSnapshot(config);
  } catch {
    // The choice is one switch in Settings. Not being able to save it is no
    // reason to stop someone getting their key set up.
  }

  showStep('check');
}

// ---------- 2. is this computer ready ----------

function agentRow(state: SshAgentState | null): HTMLLIElement {
  const text = describeAgentForSetup(state, typeof window.desktopApi?.repairSshAgent === 'function');
  let button: HTMLButtonElement | null = null;

  if (text.action !== undefined) {
    button = el('button', {
      className: 'btn btn-primary btn-sm',
      text: text.action,
      attrs: { type: 'button' }
    });
    button.addEventListener('click', () => {
      void withButtonBusy(button, async () => {
        await startAgent();
        await renderCheck();
      });
    });
  }

  return el('li', {
    className: `setup-item setup-item-${text.tone}`,
    children: [
      icon(text.icon, 20),
      el('div', {
        className: 'setup-item-text',
        children: [
          el('span', { className: 'setup-item-name', text: text.name }),
          el('span', { className: 'setup-item-detail', text: text.detail })
        ]
      }),
      button
    ]
  }) as HTMLLIElement;
}

async function renderCheck(): Promise<void> {
  await Promise.all([refreshPrerequisites(), refreshAgent()]);

  const report = prerequisites();
  const agent = agentState();
  // Git Bash arrives with Git, so it is only worth a line when it is missing.
  const tools = (report?.tools ?? []).filter((tool) => tool.id !== 'git-bash' || !tool.installed);
  const blocked = report?.blocked === true;
  const agentNeedsAttention = agent !== null && agent.availability !== 'ready';
  const optionalOnly = tools.every((tool) => tool.installed || tool.id === 'gh');

  ui.wizardCheckLead.textContent = blocked
    ? 'Git is missing, and Multi-Git cannot do anything without it. Install it, then press Check again.'
    : agentNeedsAttention || !optionalOnly
      ? 'Nearly there. One thing below could use a click.'
      : 'Everything Multi-Git needs is here.';

  ui.wizardCheckList.replaceChildren(...tools.map(prerequisiteRow), agentRow(agent));

  asButton(ui.btnWizardCheckNext).disabled = blocked;
}

// ---------- 3. the key ----------

function setKeyFeedback(message: string, tone: 'info' | 'error' = 'info'): void {
  ui.wizardKeyFeedback.textContent = message;
  ui.wizardKeyFeedback.dataset['tone'] = tone;
  setHidden(ui.wizardKeyFeedback, message === '');
}

function showValidation(message: string, tone: 'ok' | 'fail' | ''): void {
  ui.wizardValidateResult.textContent = message;
  ui.wizardValidateResult.dataset['tone'] = tone;
  setHidden(ui.wizardValidateResult, message === '');
}

function showKeyReady(status: string): void {
  setHidden(ui.wizardKeyForm, true);
  setHidden(ui.wizardKeyReady, false);
  ui.wizardKeyStatus.textContent = status;
  ui.btnWizardFinish.textContent = 'Finish';
}

async function renderKey(): Promise<void> {
  showValidation('', '');
  setKeyFeedback('');

  if (profileId !== null) {
    return;
  }

  const { sshProfiles, defaultAccountProfileId } = getState();
  const existing =
    sshProfiles.find((profile) => profile.id === defaultAccountProfileId) ?? sshProfiles[0];

  if (!existing) {
    setHidden(ui.wizardKeyForm, false);
    setHidden(ui.wizardKeyReady, true);
    ui.btnWizardFinish.textContent = 'Skip for now';
    return;
  }

  // Someone who already has a key is not asked to make another. They get the
  // same copy and validate buttons for the one they have.
  profileId = existing.id;
  showKeyReady(`You already have a key: ${existing.label}.`);

  try {
    publicKey = (await api.getPublicKey({ profileId: existing.id })).publicKey;
  } catch {
    publicKey = '';
  }
  asButton(ui.btnWizardCopyKey).disabled = publicKey === '';
}

async function copyKey(announce: boolean): Promise<boolean> {
  if (publicKey === '') {
    return false;
  }

  try {
    await navigator.clipboard.writeText(publicKey);
    if (announce) {
      ui.wizardKeyStatus.textContent = 'Copied. Paste it into GitHub with the steps below.';
    }
    return true;
  } catch {
    if (announce) {
      ui.wizardKeyStatus.textContent = 'Could not reach the clipboard. Try the button once more.';
    }
    return false;
  }
}

async function createKey(): Promise<void> {
  const userName = asInput(ui.wizardKeyName).value.trim();
  const userEmail = asInput(ui.wizardKeyEmail).value.trim();

  if (userName === '' || userEmail === '') {
    setKeyFeedback('Fill in your name and email first. They are what your commits are signed off with.', 'error');
    return;
  }

  setKeyFeedback('Creating your key…');

  await withButtonBusy(ui.btnWizardCreateKey, async () => {
    try {
      const created = await api.generateSshKey({ label: 'GitHub', keyType: 'ed25519', userName, userEmail });
      applyConfigSnapshot(created.config);
      profileId = created.profileId;
      publicKey = created.publicKey;

      // The first key is the one new folders should use, and the name and email
      // just typed are what Git should put on commits everywhere.
      try {
        applyConfigSnapshot((await api.setDefaultAccount(created.profileId, true)).config);
      } catch {
        // The key exists and works without being the default.
      }

      setKeyFeedback('');
      asButton(ui.btnWizardCopyKey).disabled = false;
      showKeyReady(
        (await copyKey(false))
          ? 'Your key is ready, and its public half is already on your clipboard.'
          : 'Your key is ready. Press Copy public key to put it on your clipboard.'
      );
    } catch (error) {
      setKeyFeedback(errorMessage(error, 'The key could not be created.'), 'error');
    }
  });
}

async function validateKey(): Promise<void> {
  if (profileId === null) {
    return;
  }

  showValidation('Asking GitHub who this key belongs to…', '');

  try {
    const { check, host, config } = await api.verifySshAccount(profileId, '');
    applyConfigSnapshot(config);

    const result = describeValidation(check, host);
    showValidation(result.message, result.ok ? 'ok' : 'fail');
  } catch (error) {
    showValidation(`Not validated: ${errorMessage(error, 'the check could not be run.')}`, 'fail');
  }
}

// ---------- leaving ----------

/** Closes the guide and remembers that it has been seen. */
export async function finishWizard(): Promise<void> {
  setHidden(ui.setupWizard, true);
  setHidden(ui.welcomeHome, false);

  // Started from Settings over an open repository: put the workspace back.
  if (getState().activeRepo) {
    setHidden(ui.noRepoOverlay, true);
  }

  try {
    applyConfigSnapshot((await api.saveAppSettings({ experienceChosen: true })).config);
  } catch {
    // It will offer itself once more next time, which is the harmless failure.
  }
}
