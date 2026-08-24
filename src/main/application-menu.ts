// The native macOS application menu.
//
// A BrowserWindow can handle application shortcuts in page JavaScript, but
// macOS still expects the standard app, Edit and Window menus. In particular,
// text editing and Services use native roles rather than renderer commands.
import type { MenuItemConstructorOptions } from 'electron';

export function macApplicationMenuTemplate(
  appName = 'Multi-Git Client'
): MenuItemConstructorOptions[] {
  return [
    {
      label: appName,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    { label: 'File', submenu: [{ role: 'close' }] },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
        { type: 'separator' },
        { role: 'startSpeaking' },
        { role: 'stopSpeaking' }
      ]
    },
    { label: 'View', submenu: [{ role: 'togglefullscreen' }] },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' }
      ]
    }
  ];
}
