// Terminal Log: the renderer posts lines to the server, which buffers them and
// broadcasts to the pop-out log window over SSE.
import { postLog } from '../api/endpoints';

export type LogType = 'info' | 'success' | 'error' | 'cmd';

/** Records a line. Never throws: logging must not break the action it describes. */
export function logToTerminal(text: string, type: LogType = 'info'): void {
  void postLog(text, type).catch(() => {
    // The server is the only place logs live; if it is unreachable the
    // console is the last resort.
    console.log(`[${type}] ${text}`);
  });
}

export function openLogWindow(): void {
  if (window.desktopApi?.openLogWindow) {
    void window.desktopApi.openLogWindow();
    return;
  }

  // Browser mode: the window name means repeated clicks reuse one tab.
  window.open('/logs.html', 'multi-git-logs');
}
