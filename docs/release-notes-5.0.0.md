# Multi-Git 5.0.0 · Three platforms. One workspace.

**Multi-Git comes to Linux and macOS.** The local-first Git workspace for your repositories, accounts and SSH identities now ships for Windows, Apple silicon, Intel Macs and x86_64 Linux.

<p align="center">
  <img src="https://raw.githubusercontent.com/AnthonyKopri/multi-git/Release_v5.0.0/docs/images/multi-git-promo.gif" alt="A tour of the Multi-Git workspace, SSH identities, staging and Safety Net" width="720">
</p>

## ✨ The big additions

- **macOS, in one download.** A universal disk image supports both Apple silicon and Intel Macs. Open it, drag Multi-Git Client into Applications, and bring your repositories along.
- **Linux, your way.** Choose an AppImage, a `.deb` for Debian/Ubuntu/Linux Mint, or an `.rpm` for Fedora/openSUSE. The native packages install Git as a dependency.
- **Updates on every platform.** The Linux AppImage can download, verify and replace itself in place. macOS and Linux package installations notify you about new versions and open the release page. Windows keeps its installer and portable update flows.
- **One automated release pipeline.** GitHub Actions builds on Windows, macOS and Linux, checks the packages, and assembles all downloads and SHA-256 checksums before publication.

Your multi-repository workspace, SSH profiles, precision staging, worktrees and Safety Net are coming along for the ride.

## 📦 Pick your download

| Platform | Download | Best for |
| --- | --- | --- |
| Windows | [Installer](https://github.com/AnthonyKopri/multi-git/releases/download/Release_v5.0.0/Multi-Git-Client-Setup-5.0.0.exe) | Recommended Windows installation |
| Windows | [Portable executable](https://github.com/AnthonyKopri/multi-git/releases/download/Release_v5.0.0/Multi-Git-Client-Portable-5.0.0.exe) | Running without installation |
| macOS | [Universal DMG](https://github.com/AnthonyKopri/multi-git/releases/download/Release_v5.0.0/Multi-Git-Client-macOS-5.0.0.dmg) | Apple silicon and Intel Macs |
| Linux | [AppImage](https://github.com/AnthonyKopri/multi-git/releases/download/Release_v5.0.0/Multi-Git-Client-Linux-5.0.0-x86_64.AppImage) | x86_64 systems with FUSE 2 |
| Linux | [DEB package](https://github.com/AnthonyKopri/multi-git/releases/download/Release_v5.0.0/Multi-Git-Client-Linux-5.0.0-amd64.deb) | Debian, Ubuntu and Linux Mint (amd64) |
| Linux | [RPM package](https://github.com/AnthonyKopri/multi-git/releases/download/Release_v5.0.0/Multi-Git-Client-Linux-5.0.0-x86_64.rpm) | Fedora and openSUSE (x86_64) |

## 🍎 macOS: one extra step on first launch

> [!IMPORTANT]
> **The macOS build is currently unsigned by an identified developer and is not notarized by Apple.** It uses an ad-hoc signature, which does not verify the developer's identity, so macOS may block the first launch.

1. Download the DMG above and drag **Multi-Git Client** into **Applications**.
2. Try opening the app once. If macOS blocks it, open **System Settings → Privacy & Security**.
3. Choose **Open Anyway** for Multi-Git Client and confirm the prompt.

Only approve a copy downloaded from this repository's official release page. [Apple's guide to opening an app from an unidentified developer](https://support.apple.com/en-us/102445) explains the process. Git must also be installed and available on your Mac.

## 🐧 Linux: getting started

**Debian / Ubuntu / Linux Mint** — install the downloaded package:

```bash
sudo apt install ./Multi-Git-Client-Linux-5.0.0-amd64.deb
```

**Fedora** — install the downloaded package:

```bash
sudo dnf install ./Multi-Git-Client-Linux-5.0.0-x86_64.rpm
```

**openSUSE** — install the downloaded package:

```bash
sudo zypper install --allow-unsigned-rpm ./Multi-Git-Client-Linux-5.0.0-x86_64.rpm
```

**AppImage** — install Git and FUSE 2, then make the file executable and launch it:

```bash
chmod +x Multi-Git-Client-Linux-5.0.0-x86_64.AppImage
./Multi-Git-Client-Linux-5.0.0-x86_64.AppImage
```

> [!NOTE]
> Ubuntu 22.04 and later do not include FUSE 2 by default. Install `libfuse2t64` on Ubuntu 24.04 and later, or `libfuse2` on Ubuntu 22.04. You can also choose the `.deb`, which does not need FUSE. Linux downloads in this release are for x86_64; ARM64 Linux is not included.

## 🔧 A little more polish

- The welcome screen keeps its layout while the icon font loads: no stretched logo or overflowing buttons on first paint.
- Windows packaging now uses `resedit` to set the app icon and version information, replacing the deprecated `rcedit` dependency.
- Release verification now requires every platform's download, so incomplete releases cannot pass the final check.

## Updating and verifying

Existing Windows users can update from the app or install 5.0.0 from the downloads above. Windows builds are also currently unsigned and may trigger SmartScreen; use only the official release downloads.

macOS and `.deb`/`.rpm` users install future updates from the release page. AppImage users can update in the app; the downloaded replacement is checked against the published SHA-256 checksum before installation.

[SHA256SUMS.txt](https://github.com/AnthonyKopri/multi-git/releases/download/Release_v5.0.0/SHA256SUMS.txt) contains a checksum for all six downloads. Compare your file using `Get-FileHash -Algorithm SHA256` on Windows, `shasum -a 256` on macOS, or `sha256sum` on Linux.

---

[Full changelog](https://github.com/AnthonyKopri/multi-git/blob/Release_v5.0.0/CHANGELOG.md) · [Everything since 4.1.4](https://github.com/AnthonyKopri/multi-git/compare/Release_v4.1.4...Release_v5.0.0) · [Getting started](https://github.com/AnthonyKopri/multi-git/blob/Release_v5.0.0/README.md#five-minute-guide)
