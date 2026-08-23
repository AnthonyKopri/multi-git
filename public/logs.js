// Terminal Log window.
//
// Moved out of an inline <script> in logs.html so the Content-Security-Policy
// can keep script-src at 'self' with no 'unsafe-inline'. The renderer builds
// DOM from repository data, so blocking inline script is what stops a
// rendering mistake from becoming code execution in a page that can drive the
// local API.
const output = document.getElementById('log-output');
const statusEl = document.getElementById('log-status');
let stickToBottom = true;

output.addEventListener('scroll', () => {
  stickToBottom = output.scrollTop + output.clientHeight >= output.scrollHeight - 8;
});

// A refresh runs upwards of forty git commands and nearly all are questions.
// The server classifies them; this window shows the actions, matching the panel
// in the main window. Untick to see everything.
const showReads = document.getElementById('show-reads');

function isRead(entry) {
  return entry.command !== undefined && entry.command.kind === 'read';
}

function appendLine(entry) {
  if (isRead(entry) && !showReads.checked) {
    return;
  }

  const line = document.createElement('div');

  if (entry.type === 'error') {
    line.className = 'logger-line-error';
    line.innerText = '[ERROR] ' + entry.text;
  } else if (entry.type === 'success') {
    line.className = 'logger-line-success';
    line.innerText = '[SUCCESS] ' + entry.text;
  } else if (entry.type === 'cmd') {
    line.className = 'logger-line-cmd';
    line.innerText = '$ ' + entry.text;
  } else {
    line.innerText = entry.text;
  }

  output.appendChild(line);
  if (stickToBottom) {
    output.scrollTop = output.scrollHeight;
  }
}

document.getElementById('btn-clear-view').addEventListener('click', () => {
  output.innerHTML = '';
  appendLine({ text: 'View cleared (history is kept on the server).', type: 'info' });
});

// Redraw from what was received, so ticking Reads reveals what was filtered out
// rather than only affecting what arrives next.
let received = [];
showReads.addEventListener('change', () => {
  output.innerHTML = '';
  received.forEach(appendLine);
});

const source = new EventSource('/api/logs/stream');

source.addEventListener('backlog', (event) => {
  output.innerHTML = '';
  const entries = JSON.parse(event.data);
  received = entries.slice();

  if (entries.length === 0) {
    appendLine({
      text: 'Multi-Git terminal log ready. Git activity will appear here.',
      type: 'info'
    });
  } else {
    entries.forEach(appendLine);
  }

  statusEl.innerText = 'live';
});

source.onmessage = (event) => {
  const entry = JSON.parse(event.data);
  received.push(entry);
  if (received.length > 4000) {
    received = received.slice(-2000);
  }
  appendLine(entry);
};

source.onerror = () => {
  statusEl.innerText = 'reconnecting…';
};

source.onopen = () => {
  statusEl.innerText = 'live';
};
