# GrainTrack Ubuntu 24.04 bootstrap

This folder contains a configurable bootstrap script that takes a barebones Ubuntu 24.04 install to a smooth workstation. Because no preference was specified, the defaults are:

- Grain target: GrainTrack web launcher (`web`)
- Desktop: full Ubuntu Desktop GNOME (`full`)
- Profile: daily operator workstation (`operator`)

The script still supports the other paths: Grain language CLI, Google Grain for Python, private Git repos, minimal/Xfce/KDE/no desktop, developer tooling, and kiosk mode.

## Quick start

```bash
chmod +x install-grain-track-ubuntu.sh
sudo bash install-grain-track-ubuntu.sh
sudo reboot
```

Preview without changing anything:

```bash
bash install-grain-track-ubuntu.sh --dry-run
```

## Common examples

Full default workstation:

```bash
sudo bash install-grain-track-ubuntu.sh
```

Minimal desktop kiosk that opens GrainTrack at login:

```bash
sudo bash install-grain-track-ubuntu.sh --desktop minimal --profile kiosk --grain-url https://graintrack.com/en/
```

Developer workstation with the Grain language CLI:

```bash
sudo bash install-grain-track-ubuntu.sh --profile developer --grain-target grain-lang
```

Private/internal GrainTrack repo:

```bash
sudo bash install-grain-track-ubuntu.sh --grain-target private --private-repo git@github.com:YOURORG/grain-track.git
```

Add `--run-private-install` only if you trust the repo's `./install.sh`.

## What it installs/configures

- Ubuntu package updates/full upgrade, unattended security upgrades, APT lock waiting, cleanup
- Ubuntu Desktop GNOME by default, or minimal/Xfce/KDE/none via `--desktop`
- Hardware enablement: `ubuntu-drivers`, firmware refresh, headers/DKMS in developer profile, `thermald`, `earlyoom`, `fwupd`
- Daily tools: browser, LibreOffice, VLC, printing/scanning, archive tools, remote desktop client, system utilities
- Security defaults: UFW enabled, automatic updates; OpenSSH is not installed unless requested
- GrainTrack targets:
  - `web`: installs a `graintrack` command and desktop launcher
  - `grain-lang`: installs the Linux x64 Grain CLI from `grain-lang/grain` releases
  - `google-grain`: creates `/opt/grain-python` and installs the Python `grain` package
  - `private`: clones your repo and detects common project types

## Logs and safety

- Log: `/var/log/grain-track-ubuntu-bootstrap.log`
- The script auto-enables SSH firewall allowance if it detects it is running over SSH.
- It does not reboot unless `--reboot` is passed.
- Use `--install-ssh --allow-ssh` on machines that need remote access.

## Options

Run:

```bash
bash install-grain-track-ubuntu.sh --help
```
