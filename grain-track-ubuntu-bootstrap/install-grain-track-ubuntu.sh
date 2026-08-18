#!/usr/bin/env bash
# Bootstrap a barebones Ubuntu 24.04 machine into a smooth GrainTrack-ready workstation.
# Defaults chosen for a daily operator workstation: GrainTrack web, full Ubuntu Desktop GNOME.

set -Eeuo pipefail
IFS=$'\n\t'

readonly SCRIPT_NAME="${0##*/}"
readonly SCRIPT_VERSION="1.0.0"
readonly GRAIN_URL_DEFAULT="https://graintrack.com/en/"

LOG_FILE="/var/log/grain-track-ubuntu-bootstrap.log"
GRAIN_URL="$GRAIN_URL_DEFAULT"

# Configurable defaults. Override with flags below.
DESKTOP="full"              # full|minimal|xfce|kde|none
PROFILE="operator"          # operator|developer|kiosk
GRAIN_TARGET="web"          # web|grain-lang|google-grain|private
PRIVATE_REPO=""
PRIVATE_BRANCH=""
PRIVATE_DEST=""
RUN_PRIVATE_INSTALL=0
TIMEZONE=""
NEW_HOSTNAME=""
INSTALL_CHROME=0
WITH_FLATPAK=0
ENABLE_FIREWALL=1
INSTALL_SSH=0
ALLOW_SSH=0
SKIP_DRIVERS=0
UPDATE_FIRMWARE=0
ACCEPT_EULAS=0
AUTO_REBOOT=0
DRY_RUN=0

APT_OPTS=(
  -o Dpkg::Options::=--force-confdef
  -o Dpkg::Options::=--force-confold
  -o DPkg::Lock::Timeout=600
)

ORIG_ARGS=("$@")
REAL_USER="root"
REAL_HOME="/root"

usage() {
  cat <<'USAGE'
Usage: sudo bash install-grain-track-ubuntu.sh [options]

Defaults (used when you have no preference):
  --desktop full          Install full Ubuntu Desktop GNOME
  --profile operator      Daily operator workstation tools
  --grain-target web      Create a GrainTrack web launcher and ensure a browser

Options:
  --desktop full|minimal|xfce|kde|none
  --profile operator|developer|kiosk
  --grain-target web|grain-lang|google-grain|private
  --grain-url URL                 Override the GrainTrack web URL
  --private-repo URL              Git repo for --grain-target private
  --private-branch NAME           Optional branch for --private-repo
  --private-dest PATH             Optional clone destination for --private-repo
  --run-private-install           Run a detected executable ./install.sh in a private repo
  --timezone AREA/CITY            Example: America/Chicago
  --hostname NAME                 Set the machine hostname
  --install-chrome                Install Google Chrome in addition to Firefox
  --with-flatpak                  Install Flatpak and add Flathub
  --no-firewall                   Do not enable UFW
  --install-ssh                   Install OpenSSH server
  --allow-ssh                     Allow OpenSSH through UFW (auto-enabled if run over SSH)
  --skip-drivers                  Skip ubuntu-drivers autoinstall
  --update-firmware               Run fwupdmgr update after refresh
  --accept-eulas                  Accept Microsoft font EULA and install ttf-mscorefonts-installer
  --reboot                        Reboot automatically at the end
  --dry-run                       Print actions without changing the system
  --version                       Print script version
  --help                          Show this help

Examples:
  sudo bash install-grain-track-ubuntu.sh
  sudo bash install-grain-track-ubuntu.sh --profile developer --grain-target grain-lang
  sudo bash install-grain-track-ubuntu.sh --desktop minimal --profile kiosk --grain-url https://graintrack.com/en/
  bash install-grain-track-ubuntu.sh --dry-run --desktop none --grain-target web
USAGE
}

log() {
  printf '[%s] %s\n' "$(date +'%Y-%m-%d %H:%M:%S')" "$*"
}

warn() {
  log "WARNING: $*" >&2
}

die() {
  log "ERROR: $*" >&2
  exit 1
}

run() {
  if (( DRY_RUN )); then
    printf 'DRY-RUN:'
    printf ' %q' "$@"
    printf '\n'
    return 0
  fi
  "$@"
}

run_as_user() {
  if [[ "$REAL_USER" == "root" ]]; then
    run "$@"
  else
    run sudo -u "$REAL_USER" -H "$@"
  fi
}

root_write() {
  local path="$1"
  local mode="$2"
  if (( DRY_RUN )); then
    log "DRY-RUN: would write $path"
    cat >/dev/null
    return 0
  fi
  install -d -m 0755 "$(dirname "$path")"
  cat >"$path"
  chmod "$mode" "$path"
}

setup_logging() {
  if (( DRY_RUN )) && (( EUID != 0 )); then
    LOG_FILE=""
    return 0
  fi
  install -d -m 0755 "$(dirname "$LOG_FILE")"
  touch "$LOG_FILE"
  chmod 0640 "$LOG_FILE" || true
  exec > >(tee -a "$LOG_FILE") 2>&1
}

parse_args() {
  while (($#)); do
    case "$1" in
      --desktop) DESKTOP="${2:?}"; shift 2 ;;
      --profile) PROFILE="${2:?}"; shift 2 ;;
      --grain-target) GRAIN_TARGET="${2:?}"; shift 2 ;;
      --grain-url) GRAIN_URL="${2:?}"; shift 2 ;;
      --private-repo) PRIVATE_REPO="${2:?}"; shift 2 ;;
      --private-branch) PRIVATE_BRANCH="${2:?}"; shift 2 ;;
      --private-dest) PRIVATE_DEST="${2:?}"; shift 2 ;;
      --run-private-install) RUN_PRIVATE_INSTALL=1; shift ;;
      --timezone) TIMEZONE="${2:?}"; shift 2 ;;
      --hostname) NEW_HOSTNAME="${2:?}"; shift 2 ;;
      --install-chrome) INSTALL_CHROME=1; shift ;;
      --with-flatpak) WITH_FLATPAK=1; shift ;;
      --no-firewall) ENABLE_FIREWALL=0; shift ;;
      --install-ssh) INSTALL_SSH=1; shift ;;
      --allow-ssh) ALLOW_SSH=1; shift ;;
      --skip-drivers) SKIP_DRIVERS=1; shift ;;
      --update-firmware) UPDATE_FIRMWARE=1; shift ;;
      --accept-eulas) ACCEPT_EULAS=1; shift ;;
      --reboot) AUTO_REBOOT=1; shift ;;
      --dry-run) DRY_RUN=1; shift ;;
      --version) printf '%s %s\n' "$SCRIPT_NAME" "$SCRIPT_VERSION"; exit 0 ;;
      --help|-h) usage; exit 0 ;;
      *) die "Unknown option: $1. Use --help." ;;
    esac
  done
}

validate_args() {
  case "$DESKTOP" in full|minimal|xfce|kde|none) ;; *) die "Invalid --desktop: $DESKTOP" ;; esac
  case "$PROFILE" in operator|developer|kiosk) ;; *) die "Invalid --profile: $PROFILE" ;; esac
  case "$GRAIN_TARGET" in web|grain-lang|google-grain|private) ;; *) die "Invalid --grain-target: $GRAIN_TARGET" ;; esac
  if [[ "$GRAIN_TARGET" == "private" && -z "$PRIVATE_REPO" ]]; then
    die "--grain-target private requires --private-repo URL"
  fi
  if [[ "$PROFILE" == "kiosk" && "$DESKTOP" == "none" ]]; then
    die "--profile kiosk requires a desktop; use --desktop full, minimal, xfce, or kde"
  fi
}

require_root_or_reexec() {
  if (( EUID == 0 )); then
    return 0
  fi
  if (( DRY_RUN )); then
    warn "Dry-run is continuing without root; no changes will be made."
    return 0
  fi
  exec sudo -E bash "$0" "${ORIG_ARGS[@]}"
}

detect_context() {
  REAL_USER="${SUDO_USER:-$(logname 2>/dev/null || printf 'root')}"
  if ! getent passwd "$REAL_USER" >/dev/null; then
    REAL_USER="root"
  fi
  REAL_HOME="$(getent passwd "$REAL_USER" | cut -d: -f6)"
  [[ -n "$REAL_HOME" ]] || REAL_HOME="/root"

  # Avoid locking someone out if they are running this over SSH.
  if [[ -n "${SSH_CONNECTION:-}${SSH_TTY:-}" && $ALLOW_SSH -eq 0 ]]; then
    warn "SSH session detected; enabling --allow-ssh so UFW does not cut off this session."
    ALLOW_SSH=1
  fi
}

check_os() {
  # shellcheck disable=SC1091
  source /etc/os-release
  if [[ "${ID:-}" != "ubuntu" ]]; then
    warn "This script is tuned for Ubuntu; detected ID=${ID:-unknown}."
  fi
  if [[ "${VERSION_ID:-}" != 24.04* ]]; then
    warn "This script is tuned for Ubuntu 24.04; detected VERSION_ID=${VERSION_ID:-unknown}."
  fi
  local arch
  arch="$(dpkg --print-architecture)"
  if [[ "$arch" != "amd64" ]]; then
    warn "Detected architecture $arch. GrainTrack web is fine; grain-lang prebuilt binaries are x64-focused."
  fi
  log "Detected OS: ${PRETTY_NAME:-unknown} ($arch)"
}

apt_wait() {
  (( DRY_RUN )) && return 0
  while fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 || \
        fuser /var/lib/apt/lists/lock >/dev/null 2>&1 || \
        fuser /var/cache/apt/archives/lock >/dev/null 2>&1; do
    sleep 2
  done
}

apt_get() {
  apt_wait
  run env DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a NEEDRESTART_SUSPEND=1 \
    apt-get "${APT_OPTS[@]}" "$@"
}

apt_update() {
  apt_get update
}

apt_install_required() {
  (($#)) || return 0
  apt_get install -y "$@"
}

apt_install_optional() {
  (($#)) || return 0
  if ! apt_get install -y "$@"; then
    warn "Optional package set failed: $*"
    return 0
  fi
}

snap_run() {
  if ! command -v snap >/dev/null 2>&1; then
    warn "snap is not available; skipped: snap $*"
    return 0
  fi
  if ! run snap "$@"; then
    warn "snap command failed: snap $*"
  fi
}

preseed_eulas() {
  (( ACCEPT_EULAS )) || return 0
  if (( DRY_RUN )); then
    log "DRY-RUN: would accept mscorefonts EULA"
    return 0
  fi
  printf '%s\n' 'msttcorefonts msttcorefonts/accepted-mscorefonts-eula select true' | debconf-set-selections
  printf '%s\n' 'msttcorefonts msttcorefonts/present-mscorefonts-eula note' | debconf-set-selections
}

configure_basics() {
  log "Configuring timezone, hostname, NTP, and unattended upgrades"
  if [[ -n "$TIMEZONE" ]]; then
    run timedatectl set-timezone "$TIMEZONE"
  fi
  if [[ -n "$NEW_HOSTNAME" ]]; then
    run hostnamectl set-hostname "$NEW_HOSTNAME"
  fi
  run timedatectl set-ntp true || warn "Could not enable NTP"

  apt_install_required ca-certificates curl wget gnupg lsb-release software-properties-common \
    apt-transport-https unattended-upgrades apt-listchanges needrestart

  root_write /etc/apt/apt.conf.d/20auto-upgrades 0644 <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Download-Upgradeable-Packages "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
  run systemctl enable --now unattended-upgrades || warn "unattended-upgrades could not be enabled"
}

update_system() {
  log "Updating Ubuntu package lists and installed packages"
  preseed_eulas
  apt_update
  apt_get full-upgrade -y
  apt_install_required ubuntu-drivers-common fwupd
  run systemctl enable --now fwupd-refresh.timer || warn "fwupd refresh timer unavailable"
  if ! run fwupdmgr refresh --force; then
    warn "fwupdmgr refresh failed"
  fi
  if (( UPDATE_FIRMWARE )); then
    if ! run fwupdmgr update -y; then
      warn "fwupdmgr update failed"
    fi
  fi
  if (( SKIP_DRIVERS )); then
    log "Skipping ubuntu-drivers autoinstall"
  elif command -v ubuntu-drivers >/dev/null 2>&1; then
    if (( DRY_RUN )) || ubuntu-drivers devices 2>/dev/null | grep -q .; then
      if ! run ubuntu-drivers autoinstall; then
        warn "ubuntu-drivers autoinstall failed; check Additional Drivers after reboot"
      fi
    else
      log "No proprietary driver candidates found"
    fi
  fi
}

install_core_tools() {
  log "Installing core command-line and system tools"
  local core=(
    git jq zip unzip p7zip-full rsync xdg-utils dbus-x11 bash-completion command-not-found
    less nano vim htop btop tmux screen tree ncdu net-tools dnsutils iputils-ping traceroute
    mtr-tiny whois lshw pciutils usbutils dmidecode smartmontools nvme-cli lm-sensors ethtool
    iw wireless-tools wpasupplicant rfkill bluez bolt udisks2 gvfs-backends gvfs-fuse fuse3
    sshfs cifs-utils nfs-common exfatprogs ntfs-3g earlyoom thermald powertop locales
    fonts-noto fonts-liberation fonts-dejavu libavcodec-extra ffmpeg imagemagick graphicsmagick
    openvpn
  )
  apt_install_required "${core[@]}"
  run locale-gen en_US.UTF-8 || warn "locale-gen en_US.UTF-8 failed"
  run systemctl enable --now earlyoom || warn "earlyoom could not be enabled"
  run systemctl enable --now thermald || warn "thermald could not be enabled (normal on non-Intel or VMs)"
}

install_desktop() {
  [[ "$DESKTOP" == "none" ]] && return 0
  log "Installing desktop: $DESKTOP"
  case "$DESKTOP" in
    full) apt_install_required ubuntu-desktop ;;
    minimal) apt_install_required ubuntu-desktop-minimal ;;
    xfce) apt_install_required xubuntu-desktop ;;
    kde) apt_install_required kubuntu-desktop ;;
  esac
  run systemctl set-default graphical.target

  local desktop_extras=(
    gnome-keyring seahorse gnome-text-editor gnome-system-monitor gnome-logs baobab
    gnome-disk-utility gparted file-roller evince eog simple-scan system-config-printer
    cups cups-browsed sane-airscan libreoffice vlc pavucontrol pulseaudio-utils alsa-utils
    network-manager-openvpn-gnome remmina remmina-plugin-rdp remmina-plugin-vnc blueman
    ubuntu-restricted-addons
  )
  apt_install_optional "${desktop_extras[@]}"

  if (( ACCEPT_EULAS )); then
    apt_install_optional ttf-mscorefonts-installer ubuntu-restricted-extras
  fi

  if getent group lpadmin >/dev/null && [[ "$REAL_USER" != "root" ]]; then
    run usermod -aG lpadmin "$REAL_USER" || warn "Could not add $REAL_USER to lpadmin"
  fi
  for group in scanner saned plugdev; do
    if getent group "$group" >/dev/null && [[ "$REAL_USER" != "root" ]]; then
      run usermod -aG "$group" "$REAL_USER" || warn "Could not add $REAL_USER to $group"
    fi
  done
}

install_operator_profile() {
  log "Installing operator profile extras"
  local operator=(
    gnome-tweaks dconf-editor hardinfo psensor usb-creator-gtk gnome-firmware
  )
  apt_install_optional "${operator[@]}"
}

install_developer_profile() {
  log "Installing developer profile extras"
  local required=(build-essential make cmake pkg-config python3 python3-pip python3-venv python3-dev pipx)
  local optional=(
    dkms "linux-headers-$(uname -r)" gcc g++ clang lldb gdb valgrind ccache ninja-build meson
    autoconf automake libtool gettext nodejs npm golang-go rustc cargo docker.io podman
    shellcheck shfmt clang-format black isort mypy pre-commit
  )
  apt_install_required "${required[@]}"
  apt_install_optional "${optional[@]}"
  if getent group docker >/dev/null && [[ "$REAL_USER" != "root" ]]; then
    run usermod -aG docker "$REAL_USER" || warn "Could not add $REAL_USER to docker"
    warn "Docker group membership grants root-equivalent access; log out/in for it to take effect."
  fi
}

install_kiosk_profile() {
  log "Configuring kiosk profile for $GRAIN_URL"
  root_write /usr/local/bin/graintrack-kiosk 0755 <<EOF
#!/usr/bin/env bash
URL="$GRAIN_URL"
if command -v firefox >/dev/null 2>&1; then
  exec firefox --kiosk "\$URL"
elif command -v google-chrome >/dev/null 2>&1; then
  exec google-chrome --kiosk "\$URL"
elif command -v chromium-browser >/dev/null 2>&1; then
  exec chromium-browser --kiosk "\$URL"
else
  exec xdg-open "\$URL"
fi
EOF
  root_write /etc/xdg/autostart/graintrack-kiosk.desktop 0644 <<'EOF'
[Desktop Entry]
Type=Application
Name=GrainTrack Kiosk
Comment=Start GrainTrack in kiosk mode at login
Exec=/usr/local/bin/graintrack-kiosk
Terminal=false
X-GNOME-Autostart-enabled=true
NoDisplay=false
EOF
}

install_profile() {
  case "$PROFILE" in
    operator) install_operator_profile ;;
    developer) install_operator_profile; install_developer_profile ;;
    kiosk) install_operator_profile; install_kiosk_profile ;;
  esac
}

install_chrome() {
  (( INSTALL_CHROME )) || return 0
  log "Installing Google Chrome"
  if (( DRY_RUN )); then
    log "DRY-RUN: would add Google Chrome apt repo and install google-chrome-stable"
    return 0
  fi
  install -d -m 0755 /usr/share/keyrings
  curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg
  root_write /etc/apt/sources.list.d/google-chrome.list 0644 <<'EOF'
deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main
EOF
  apt_update
  apt_install_required google-chrome-stable
}

ensure_browser() {
  if command -v firefox >/dev/null 2>&1 || command -v google-chrome >/dev/null 2>&1 || command -v chromium-browser >/dev/null 2>&1; then
    return 0
  fi
  log "Ensuring a browser is installed"
  apt_install_required snapd
  run systemctl enable --now snapd.socket || warn "snapd.socket could not be enabled"
  if ! snap_run install firefox; then
    apt_install_optional firefox
  fi
  if ! command -v firefox >/dev/null 2>&1 && ! command -v google-chrome >/dev/null 2>&1 && ! command -v chromium-browser >/dev/null 2>&1; then
    if (( DRY_RUN )); then
      log "DRY-RUN: browser installation was simulated; no browser is expected on this host yet"
    else
      warn "No browser command was found after installation attempts"
    fi
  fi
}

install_flatpak() {
  (( WITH_FLATPAK )) || return 0
  log "Installing Flatpak and Flathub"
  apt_install_required flatpak
  if [[ "$DESKTOP" != "none" ]]; then
    apt_install_optional gnome-software-plugin-flatpak
  fi
  if (( DRY_RUN )); then
    log "DRY-RUN: would add Flathub remote"
  else
    run flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo || warn "Could not add Flathub"
  fi
}

install_ssh_and_firewall() {
  if (( INSTALL_SSH )); then
    log "Installing OpenSSH server"
    apt_install_required openssh-server
    run systemctl enable --now ssh || warn "ssh service could not be enabled"
  fi
  (( ENABLE_FIREWALL )) || return 0
  log "Configuring UFW firewall"
  apt_install_required ufw
  run ufw default deny incoming
  run ufw default allow outgoing
  if (( ALLOW_SSH )); then
    run ufw allow OpenSSH
  fi
  if ! run ufw --force enable; then
    warn "UFW could not be enabled"
  fi
}

install_grain_web() {
  log "Creating GrainTrack web launcher for $GRAIN_URL"
  ensure_browser
  root_write /usr/local/bin/graintrack 0755 <<EOF
#!/usr/bin/env sh
exec xdg-open "$GRAIN_URL"
EOF
  root_write /usr/local/share/applications/graintrack.desktop 0644 <<EOF
[Desktop Entry]
Type=Application
Name=GrainTrack
Comment=Open GrainTrack
Exec=xdg-open $GRAIN_URL
Terminal=false
Categories=Office;Network;
Icon=web-browser
EOF
  run update-desktop-database /usr/local/share/applications || true
  log "GrainTrack launcher installed. Run: graintrack"
}

install_grain_lang() {
  log "Installing Grain language CLI from grain-lang/grain releases"
  apt_install_required curl jq ca-certificates
  local tmp url
  if (( DRY_RUN )); then
    log "DRY-RUN: would query GitHub for the latest grain-linux-x64 asset and install /usr/local/bin/grain"
    return 0
  fi
  tmp="$(mktemp -d)"
  url="$(curl -fsSL https://api.github.com/repos/grain-lang/grain/releases/latest \
    | jq -r '.assets[].browser_download_url | select(test("grain-linux-x64"))' \
    | head -n 1)"
  if [[ -z "$url" || "$url" == "null" ]]; then
    warn "Latest release asset not found; falling back to the preview Linux x64 binary."
    url="https://github.com/grain-lang/grain/releases/download/preview/grain-linux-x64"
  fi
  curl -fL "$url" -o "$tmp/grain"
  install -m 0755 "$tmp/grain" /usr/local/bin/grain
  rm -rf "$tmp"
  if ! /usr/local/bin/grain --version; then
    warn "grain --version failed; the binary may need additional runtime dependencies"
  fi
}

install_google_grain() {
  log "Installing Google Grain Python library into /opt/grain-python"
  apt_install_required python3 python3-venv python3-pip
  if (( DRY_RUN )); then
    log "DRY-RUN: would create /opt/grain-python and pip install grain"
    return 0
  fi
  python3 -m venv /opt/grain-python
  /opt/grain-python/bin/pip install --upgrade pip setuptools wheel
  /opt/grain-python/bin/pip install --upgrade grain
  root_write /usr/local/bin/grain-python 0755 <<'EOF'
#!/usr/bin/env sh
exec /opt/grain-python/bin/python "$@"
EOF
  log "Google Grain installed in /opt/grain-python. Use: grain-python"
}

install_private_grain() {
  local dest="${PRIVATE_DEST:-}"
  if [[ -z "$dest" ]]; then
    if [[ "$REAL_USER" != "root" && -n "$REAL_HOME" ]]; then
      dest="$REAL_HOME/grain-track"
    else
      dest="/opt/grain-track"
    fi
  fi
  log "Cloning private GrainTrack repo to $dest"
  apt_install_required git
  if (( DRY_RUN )); then
    log "DRY-RUN: would clone $PRIVATE_REPO to $dest and detect common installers"
    return 0
  fi
  if [[ -d "$dest/.git" ]]; then
    run_as_user git -C "$dest" fetch --all --prune
    run_as_user git -C "$dest" pull --ff-only
    run_as_user git -C "$dest" submodule update --init --recursive
  else
    local clone_args=(clone --recursive)
    if [[ -n "$PRIVATE_BRANCH" ]]; then
      clone_args+=(--branch "$PRIVATE_BRANCH")
    fi
    clone_args+=("$PRIVATE_REPO" "$dest")
    run_as_user git "${clone_args[@]}"
  fi

  if [[ -x "$dest/install.sh" && $RUN_PRIVATE_INSTALL -eq 1 ]]; then
    run_as_user bash -lc "cd '$dest' && ./install.sh"
  elif [[ -x "$dest/install.sh" ]]; then
    warn "Detected $dest/install.sh but did not run it. Re-run with --run-private-install if you trust it."
  fi

  log "Detected private repo hints:"
  [[ -f "$dest/package.json" ]] && log "  Node.js project detected: package.json"
  [[ -f "$dest/pyproject.toml" || -f "$dest/requirements.txt" ]] && log "  Python project detected"
  [[ -f "$dest/Cargo.toml" ]] && log "  Rust project detected"
  [[ -f "$dest/go.mod" ]] && log "  Go project detected"
  [[ -f "$dest/docker-compose.yml" || -f "$dest/compose.yml" ]] && log "  Docker Compose project detected"
}

install_grain_target() {
  case "$GRAIN_TARGET" in
    web) install_grain_web ;;
    grain-lang) install_grain_lang ;;
    google-grain) install_google_grain ;;
    private) install_private_grain ;;
  esac
}

refresh_app_stores() {
  if command -v snap >/dev/null 2>&1; then
    snap_run wait system seed.loaded
    snap_run refresh
  fi
  if (( WITH_FLATPAK )) && command -v flatpak >/dev/null 2>&1; then
    if ! run flatpak update -y; then
      warn "flatpak update failed"
    fi
  fi
}

cleanup_system() {
  log "Cleaning up packages"
  apt_get autoremove --purge -y
  apt_get clean
  run updatedb || true
}

print_summary() {
  log "Bootstrap complete"
  printf '\nSummary\n'
  printf '  Script version: %s\n' "$SCRIPT_VERSION"
  printf '  Desktop:        %s\n' "$DESKTOP"
  printf '  Profile:        %s\n' "$PROFILE"
  printf '  Grain target:   %s\n' "$GRAIN_TARGET"
  printf '  Grain URL:      %s\n' "$GRAIN_URL"
  printf '  Log file:       %s\n' "${LOG_FILE:-stdout}"
  printf '\nRecommended next steps:\n'
  printf '  1. Reboot the machine.\n'
  printf '  2. Log into the desktop and open GrainTrack from the app grid or run: graintrack\n'
  printf '  3. Check Additional Drivers if hardware acceleration, Wi-Fi, or NVIDIA graphics need attention.\n'
  if [[ "$REAL_USER" != "root" ]]; then
    printf '  4. If groups were changed for %s, log out/in before expecting printer, scanner, or Docker access.\n' "$REAL_USER"
  fi
}

main() {
  parse_args "$@"
  validate_args
  require_root_or_reexec
  detect_context
  setup_logging
  log "Starting $SCRIPT_NAME $SCRIPT_VERSION"
  check_os
  configure_basics
  update_system
  install_core_tools
  install_desktop
  install_profile
  install_chrome
  install_flatpak
  install_ssh_and_firewall
  install_grain_target
  refresh_app_stores
  cleanup_system
  print_summary
  if (( AUTO_REBOOT )); then
    log "Rebooting in 1 minute (--reboot was provided). Cancel with: sudo shutdown -c"
    run shutdown -r +1
  else
    log "Reboot recommended. No automatic reboot was requested."
  fi
}

main "$@"
