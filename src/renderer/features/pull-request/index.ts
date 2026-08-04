// The pull-request creator window.
//
// Two rules shape this file:
//
//   * Preflight fills the form once, and never overwrites what the user has
//     typed. Changing the base branch re-runs preflight for the new commit
//     range, and a title already edited by hand survives that.
//
//   * A failure keeps the form open with its contents intact. Creating a pull
//     request means writing a title and a description, and losing that to a
//     transient `gh` error is the difference between a retry and giving up.
import * as api from '../../api/endpoints';
import { errorMessage, isStale } from '../../api/client';
import { asButton, asInput, asSelect, asTextArea } from '../../dom/elements';
import type { Elements } from '../../dom/elements';
import { setHidden } from '../../dom/create';
import { getState } from '../../state/store';
import { showToast } from '../../ui/toast';
import { logToTerminal } from '../../ui/log';
import { withButtonBusy } from '../../ui/busy';
import type {
  PullRequestCreateResult,
  PullRequestPreflight
} from '../../../shared/pull-request-types';

let ui: Elements;

/** The last preflight, so submit knows whether a push is needed. */
let preflight: PullRequestPreflight | null = null;
/** Fields the user has typed in. Never overwritten by a later preflight. */
const touched = new Set<'title' | 'body'>();
let created: PullRequestCreateResult | null = null;

export function initPullRequests(elements: Elements): void {
  ui = elements;

  ui.btnCreatePr.addEventListener('click', () => void openCreator());
  ui.btnClosePrModal.addEventListener('click', close);
  ui.btnPrCancel.addEventListener('click', close);

  ui.prForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void submit();
  });

  // Re-running preflight on a base change is what keeps the commit summary and
  // the ahead/behind counts honest.
  ui.prBaseBranch.addEventListener('change', () => void refresh());
  ui.prHeadBranch.addEventListener('change', () => void refresh());

  asInput(ui.prTitle).addEventListener('input', () => touched.add('title'));
  asTextArea(ui.prBody).addEventListener('input', () => touched.add('body'));

  ui.btnPrOpen.addEventListener('click', () => {
    if (created) {
      window.open(created.url, '_blank', 'noopener');
    }
  });

  ui.btnPrCopyLink.addEventListener('click', () => {
    if (!created) {
      return;
    }
    void navigator.clipboard
      .writeText(created.url)
      .then(() => showToast('Pull request link copied.', 'success'))
      .catch(() => showToast('Could not copy the link.', 'error'));
  });

  // Escape closes, matching the other modals.
  ui.prModal.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Escape') {
      close();
    }
  });
}

function close(): void {
  setHidden(ui.prModal, true);
}

function reset(): void {
  preflight = null;
  created = null;
  touched.clear();

  setHidden(ui.prForm, true);
  setHidden(ui.prSuccess, true);
  setHidden(ui.prWarnings, true);
  setFeedback('');
  ui.prLoading.textContent = 'Checking the repository…';
  setHidden(ui.prLoading, false);
}

function setFeedback(message: string, type: 'info' | 'error' | 'success' = 'info'): void {
  if (!message) {
    ui.prFeedback.className = 'inline-feedback hidden';
    ui.prFeedback.textContent = '';
    return;
  }

  ui.prFeedback.className = `inline-feedback ${type}`;
  ui.prFeedback.textContent = message;
}

export async function openCreator(): Promise<void> {
  if (!getState().activeRepo) {
    showToast('Open a repository first.', 'warn');
    return;
  }

  reset();
  setHidden(ui.prModal, false);
  await refresh();
}

/** Loads preflight and renders it into the form. */
async function refresh(): Promise<void> {
  const head = ui.prHeadBranch.children.length > 0 ? asSelect(ui.prHeadBranch).value : undefined;
  const base = ui.prBaseBranch.children.length > 0 ? asSelect(ui.prBaseBranch).value : undefined;

  try {
    const response = await api.preflightPullRequest(head, base);
    preflight = response.preflight;
    render(response.preflight);
  } catch (error) {
    if (isStale(error)) {
      return;
    }
    setHidden(ui.prLoading, true);
    setFeedback(errorMessage(error, 'Could not inspect the repository.'), 'error');
  }
}

function fillBranchSelect(select: HTMLElement, branches: readonly string[], selected: string): void {
  const element = asSelect(select);
  element.replaceChildren();

  for (const branch of branches) {
    const option = document.createElement('option');
    option.value = branch;
    // textContent, never innerHTML: a branch name is repository data, and a
    // repository is not trusted input.
    option.textContent = branch;
    option.selected = branch === selected;
    element.appendChild(option);
  }

  if (!branches.includes(selected) && selected) {
    const option = document.createElement('option');
    option.value = selected;
    option.textContent = selected;
    option.selected = true;
    element.appendChild(option);
  }
}

function render(state: PullRequestPreflight): void {
  setHidden(ui.prLoading, true);
  setHidden(ui.prForm, false);

  fillBranchSelect(ui.prBaseBranch, state.branches, state.defaultBaseBranch);
  fillBranchSelect(ui.prHeadBranch, state.branches, state.headBranch);

  ui.prTargetSummary.textContent = state.targetRepo
    ? `${state.targetRepo} · ${state.commitsAhead} commit(s) ahead, ${state.commitsBehind} behind · ${state.changedFileCount} file(s) changed`
    : 'No GitHub remote is configured for this repository.';

  if (!touched.has('title')) {
    asInput(ui.prTitle).value = state.suggestedTitle;
  }
  if (!touched.has('body')) {
    asTextArea(ui.prBody).value = state.suggestedBody;
  }

  renderWarnings(state.warnings);
  renderCommits(state.commitSubjects);

  const button = asButton(ui.btnPrCreate);
  const blocked =
    !state.cliAvailable ||
    !state.authenticated ||
    state.isDetachedHead ||
    state.commitsAhead === 0 ||
    Boolean(state.existingPullRequestUrl);

  button.disabled = blocked;
  // The label is the honest description of what pressing it will do: an
  // unpushed branch gets published first, and that should not be a surprise.
  button.textContent = state.headPushed ? 'Create pull request' : 'Push and create';
}

function renderWarnings(warnings: readonly string[]): void {
  ui.prWarnings.replaceChildren();
  setHidden(ui.prWarnings, warnings.length === 0);

  for (const warning of warnings) {
    const item = document.createElement('li');
    item.textContent = warning;
    ui.prWarnings.appendChild(item);
  }
}

function renderCommits(subjects: readonly string[]): void {
  ui.prCommitSummary.replaceChildren();

  if (subjects.length === 0) {
    return;
  }

  const heading = document.createElement('p');
  heading.className = 'pr-commit-heading';
  heading.textContent = `${subjects.length} commit(s) in this pull request`;
  ui.prCommitSummary.appendChild(heading);

  const list = document.createElement('ul');
  for (const subject of subjects.slice(0, 10)) {
    const item = document.createElement('li');
    item.textContent = subject;
    list.appendChild(item);
  }
  ui.prCommitSummary.appendChild(list);
}

/** Splits a comma-separated field, dropping blanks. */
function nameList(element: HTMLElement): string[] {
  return asInput(element)
    .value.split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function submit(): Promise<void> {
  if (!preflight) {
    return;
  }

  const title = asInput(ui.prTitle).value.trim();
  if (title === '') {
    setFeedback('A title is required.', 'error');
    asInput(ui.prTitle).focus();
    return;
  }

  const pushFirst = !preflight.headPushed;
  setFeedback(pushFirst ? 'Pushing the branch, then creating…' : 'Creating…');

  await withButtonBusy(ui.btnPrCreate, async () => {
    try {
      const response = await api.createPullRequest({
        repoPath: getState().activeRepo ?? '',
        baseBranch: asSelect(ui.prBaseBranch).value,
        headBranch: asSelect(ui.prHeadBranch).value,
        title,
        body: asTextArea(ui.prBody).value,
        draft: (asInput(ui.prDraft) as HTMLInputElement).checked,
        maintainerCanModify: true,
        reviewers: nameList(ui.prReviewers),
        assignees: nameList(ui.prAssignees),
        labels: nameList(ui.prLabels),
        pushFirst,
        profileId: getState().activeProfileId
      });

      if (!response.success || !response.pullRequest) {
        // The form stays exactly as it was. Losing a written description to a
        // transient failure is the difference between retrying and giving up.
        setFeedback(
          response.pushed
            ? `${response.error ?? 'Creating the pull request failed.'} The branch was pushed, so retrying will not push again.`
            : (response.error ?? 'Creating the pull request failed.'),
          'error'
        );

        if (response.pushed && preflight) {
          preflight.headPushed = true;
          asButton(ui.btnPrCreate).textContent = 'Create pull request';
        }
        return;
      }

      created = response.pullRequest;
      logToTerminal(`Created pull request #${created.number}: ${created.url}`, 'success');
      showToast(`Pull request #${created.number} created.`, 'success');

      setHidden(ui.prForm, true);
      setFeedback('');
      ui.prSuccessText.textContent = `Pull request #${created.number} is ${created.state === 'draft' ? 'a draft' : 'open'}.`;
      setHidden(ui.prSuccess, false);
    } catch (error) {
      if (isStale(error)) {
        return;
      }
      setFeedback(errorMessage(error, 'Creating the pull request failed.'), 'error');
    }
  });
}
