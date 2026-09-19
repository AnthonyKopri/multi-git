# Terminal edition

`multi-git tui` is a keyboard-driven Git assistant for the terminal: the desktop app's workflows, with the same safety checks, for people who would rather not look Git commands up. It shares one backend with the desktop app, so repository locks, SSH accounts, the unlocked vault and running operations are the same in both.

## Install

- **With the desktop app:** Settings → Terminal and agents → **Enable**, or **Enable multi-git in your terminal** on the welcome screen. What will change is listed before anything is changed. The **Multi-Git CLI** button beside **Terminal** in the log panel opens the terminal UI on the current repository, even before it is enabled.
- **On its own:** download `Multi-Git-Terminal-<version>-<Windows|macOS|Linux>-<x64|arm64>` from the release page and unpack it anywhere. Run `multi-git` (on Windows `multi-git.cmd`) from that folder. It carries its own Node runtime; Git is the only requirement.

Enabling installs for the current user only:

| System | Folder | Command on PATH |
| --- | --- | --- |
| Windows | `%LOCALAPPDATA%\Multi-Git\Terminal` | The folder is added to the user PATH. |
| macOS | `~/Library/Application Support/Multi-Git/Terminal` | `~/.local/bin/multi-git`, and a marked line in the startup file of each shell you use (Bash, Zsh, Fish) when `~/.local/bin` is not already on PATH. |
| Linux | `${XDG_DATA_HOME:-~/.local/share}/multi-git/terminal` | As macOS. |

For other shells, add `~/.local/bin` to PATH yourself. Terminals that were already open do not see the change: open a new one. If another `multi-git` comes first on PATH, Settings says so and names it; nothing of yours is overwritten.

The installed copy does not depend on the desktop app: it keeps working when the app is moved, updated or uninstalled. **Remove** in Settings undoes exactly what enabling did, and leaves repositories, settings and the vault alone.

## Update

```bash
multi-git update --check
multi-git update
multi-git update --rollback
```

Updates never happen on their own. `update` downloads the newest stable release for this system, checks it against the release's `SHA256SUMS.txt`, unpacks it with the same refusals as the installer (no links, no paths outside the folder), runs it once, and only then switches to it. A terminal that is already running keeps its version. The previous version is kept for rollback. The desktop app can also upgrade the installed copy from the one it carries, but never replaces a newer one with an older one.

Standalone archives update in their extracted folder without changing PATH. `update --rollback` checks and restores the retained previous version. Cleanup waits until sessions using an older payload have exited.

## Using it

```bash
multi-git tui
multi-git tui --repo "D:\work\my repo"
```

The header always shows the repository, branch, how far ahead and behind it is, the upstream, auto-pull (Off, Ready, or Blocked with the reason) and the SSH account. The mode is at the top right: **NORMAL** for moving around, **INPUT** while typing, **SELECT** while choosing several rows, **WORKING** while something runs.

Nothing needs memorising. `Space` shows every shortcut, `:` finds any workflow by name or by what you want ("change account", "get latest"), and `?` lists the keys.

| Keys | What they do |
| --- | --- |
| `j` / `k`, arrows | Down / up |
| `h` / `l` | Back / open |
| `gg` / `G` | First / last |
| `Ctrl+d` / `Ctrl+u` | Half a page down / up |
| `Ctrl+w` then `h` `j` `k` `l` | Focus the pane in that direction |
| `Tab` / `Shift+Tab` | Next / previous pane |
| `/`, then `n` / `N` | Search this view, next / previous match |
| `:` | Find any workflow |
| `Space` | Shortcut menu |
| `Enter` | Open, or start typing into a field |
| `Esc` | Stop typing, close, or go back — never submits |
| `v` | Select several rows or diff lines |
| `s` / `u` | Stage / unstage the selection |
| `?` | Keys |
| `Ctrl+c` | Quit |

The shortcut menu:

| `Space` then | |
| --- | --- |
| `r` | Repositories |
| `b` | Branches |
| `a` | SSH account |
| `f` | Fetch (and auto-pull when it is on) |
| `p` / `P` | Pull / push or publish |
| `A` | Auto-pull on or off |
| `c` | Commit |
| `w` | Worktrees |
| `s` | Settings |
| `u` | Recovery and Safety Net |
| `o` | Operations |

These can be changed in Settings → Remap a leader shortcut; a key already in use is refused, and the menu and help always show the current keys. Typing into a field or the palette never triggers a shortcut.

Anything that changes a repository shows what it will do first — the files a commit will contain and who it is from, the commits a pull brings in and whether it merges or rebases, the account a push will use — and waits for **Confirm**. `Esc` leaves without changing anything. In a text field, `Ctrl+e` opens `VISUAL` or `EDITOR` (Vim, Neovim, `code -w`, or Notepad by default on Windows) for longer text.

Appearance: Settings → Appearance chooses the terminal's own colours, light, dark or monochrome, and ASCII-only output for consoles without Unicode. `NO_COLOR` and `TERM=dumb` are honoured. At 80×24 the panes become one column; wider terminals show the workflow list and details beside the list.

What the terminal edition covers, workflow by workflow, is in the [parity matrix](terminal-parity.md). The JSON commands and the MCP server are in [agent-cli.md](agent-cli.md) and [mcp.md](mcp.md).
