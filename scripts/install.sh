#!/usr/bin/env bash
set -euo pipefail

REPO="loopwire-dev/loopwire"
INSTALL_DIR="${HOME}/.loopwire/bin"
AUTOSTART_NAME="loopwired"
AUTOUPDATE_NAME="loopwired-autoupdate"
FRONTEND_URL="${LOOPWIRE_FRONTEND_URL:-https://loopwire.dev}"
DRY_RUN=0
UNINSTALL=0
PURGE_DATA=0

usage() {
  cat <<'EOF'
Usage: install.sh [OPTIONS]

Options:
  -n, --dry-run      Show planned actions without changing the system.
      --uninstall    Remove loopwired from this machine.
      --purge-data   With --uninstall, also delete ~/.loopwire data/config.
  -h, --help         Show this help message.
EOF
}

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      -n|--dry-run)
        DRY_RUN=1
        ;;
      --uninstall)
        UNINSTALL=1
        ;;
      --purge-data)
        PURGE_DATA=1
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        echo "Unknown argument: $1"
        usage
        exit 1
        ;;
    esac
    shift
  done

  if [ "$PURGE_DATA" -eq 1 ] && [ "$UNINSTALL" -ne 1 ]; then
    echo "--purge-data can only be used with --uninstall"
    exit 1
  fi
}

print_header() {
  cat <<'EOF'
 _                               _
| |                             (_)
| |     ___   ___  _ ____      ___ _ __ ___
| |    / _ \ / _ \| '_ \ \ /\ / / | '__/ _ \
| |___| (_) | (_) | |_) \ V  V /| | | |  __/
|______\___/ \___/| .__/ \_/\_/ |_|_|  \___|
                  | |
                  |_|
EOF
  echo ""
}

log_step() {
  echo "🔹 $*"
}

log_info() {
  echo "ℹ️  $*"
}

log_ok() {
  echo "✅ $*"
}

log_warn() {
  echo "⚠️  $*"
}

log_section() {
  local title="$1"
  echo ""
  echo "──────────────── ${title} ────────────────"
}

bootstrap_token_path() {
  echo "${HOME}/.loopwire/bootstrap_token"
}

read_bootstrap_token() {
  local token_path
  token_path="$(bootstrap_token_path)"

  if [ ! -f "$token_path" ]; then
    return 1
  fi

  tr -d '\r\n' < "$token_path"
}

build_tokenized_url() {
  local base_url="$1"
  local token="$2"
  local normalized="${base_url%/}"
  echo "${normalized}/?token=${token}"
}

detect_shell_profile() {
  case "${SHELL:-}" in
    */zsh) echo "$HOME/.zshrc" ;;
    */bash)
      if [ -f "$HOME/.bash_profile" ]; then
        echo "$HOME/.bash_profile"
      else
        echo "$HOME/.bashrc"
      fi
      ;;
    */fish) echo "$HOME/.config/fish/config.fish" ;;
    *) echo "" ;;
  esac
}

remove_path_from_profile() {
  local profile="$1"
  [ -f "$profile" ] || return 0

  local tmp
  tmp="$(mktemp)"
  awk -v install_dir="$INSTALL_DIR" '
    {
      if ($0 == "# Loopwire") { skip_next=1; next }
      if (skip_next == 1) {
        skip_next=0
        if (index($0, install_dir) > 0) next
      }
      if (index($0, install_dir) > 0 &&
          (index($0, "fish_add_path -m") > 0 || index($0, "export PATH=") > 0)) {
        next
      }
      print
    }
  ' "$profile" > "$tmp"
  mv "$tmp" "$profile"
}

sha256_file() {
  local file="$1"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 "$file" | awk '{print $NF}'
  else
    echo "No SHA-256 tool found (tried shasum, sha256sum, openssl)." >&2
    exit 1
  fi
}

extract_expected_checksum() {
  local checksums="$1"
  local filename="$2"

  printf '%s\n' "$checksums" | sed -nE \
    -e "s/^([0-9a-fA-F]{64})[[:space:]]+\\*?${filename}\$/\\1/p" \
    -e "s/^([0-9a-fA-F]{64})\\*?${filename}\$/\\1/p" \
    -e "s/^SHA2?-?256 \\(${filename}\\) = ([0-9a-fA-F]{64})\$/\\1/p" | head -n1
}

# Detect OS and architecture
detect_platform() {
  local os arch

  case "$(uname -s)" in
    Linux*)  os="linux" ;;
    Darwin*) os="darwin" ;;
    *) echo "Unsupported OS: $(uname -s)" && exit 1 ;;
  esac

  case "$(uname -m)" in
    x86_64|amd64) arch="amd64" ;;
    aarch64|arm64) arch="arm64" ;;
    *) echo "Unsupported architecture: $(uname -m)" && exit 1 ;;
  esac

  echo "${os}-${arch}"
}

run_with_sudo() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    echo "This step requires elevated privileges, but sudo is not available."
    exit 1
  fi
}

register_autostart_macos() {
  local binary_path="$1"
  local plist_dir="$HOME/Library/LaunchAgents"
  local plist_path="$plist_dir/dev.loopwire.loopwired.plist"

  mkdir -p "$plist_dir"

  cat > "$plist_path" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>dev.loopwire.loopwired</string>
  <key>ProgramArguments</key>
  <array>
    <string>${binary_path}</string>
    <string>start</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>LOOPWIRE_FRONTEND_URL</key>
    <string>${FRONTEND_URL}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${HOME}/.loopwire/loopwired.out.log</string>
  <key>StandardErrorPath</key>
  <string>${HOME}/.loopwire/loopwired.err.log</string>
</dict>
</plist>
EOF

  mkdir -p "$HOME/.loopwire"

  # Reload agent if already loaded
  if launchctl list | grep -q "dev.loopwire.loopwired"; then
    launchctl unload "$plist_path" >/dev/null 2>&1 || true
  fi

  launchctl load -w "$plist_path" >/dev/null 2>&1 || true
  launchctl kickstart -k "gui/$(id -u)/dev.loopwire.loopwired" >/dev/null 2>&1 || true

  :
}

register_autostart_linux() {
  local binary_path="$1"
  local unit_dir="$HOME/.config/systemd/user"
  local unit_path="$unit_dir/${AUTOSTART_NAME}.service"

  if ! command -v systemctl >/dev/null 2>&1; then
    echo "systemctl not found; skipping auto-start registration."
    return
  fi

  mkdir -p "$unit_dir"

  cat > "$unit_path" <<EOF
[Unit]
Description=Loopwire daemon
After=network-online.target

[Service]
Type=simple
Environment=LOOPWIRE_FRONTEND_URL=${FRONTEND_URL}
ExecStart=${binary_path} start
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF

  systemctl --user daemon-reload
  systemctl --user enable --now "${AUTOSTART_NAME}.service" >/dev/null 2>&1 || {
    echo "Could not enable user service automatically."
    echo "Try manually:"
    echo "  systemctl --user daemon-reload"
    echo "  systemctl --user enable --now ${AUTOSTART_NAME}.service"
    return
  }

  :
}

install_autoupdate_script() {
  local updater_path="${INSTALL_DIR}/loopwire-autoupdate"

  cat > "$updater_path" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

REPO="loopwire-dev/loopwire"
INSTALL_DIR="${HOME}/.loopwire/bin"
BINARY_NAME="${LOOPWIRE_BINARY_NAME:-loopwired}"
PLATFORM=""
FRONTEND_URL="${LOOPWIRE_FRONTEND_URL:-https://loopwire.dev}"

sha256_file() {
  local file="$1"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 "$file" | awk '{print $NF}'
  else
    echo "No SHA-256 tool found (tried shasum, sha256sum, openssl)." >&2
    exit 1
  fi
}

extract_expected_checksum() {
  local checksums="$1"
  local filename="$2"

  printf '%s\n' "$checksums" | sed -nE \
    -e "s/^([0-9a-fA-F]{64})[[:space:]]+\\*?${filename}\$/\\1/p" \
    -e "s/^([0-9a-fA-F]{64})\\*?${filename}\$/\\1/p" \
    -e "s/^SHA2?-?256 \\(${filename}\\) = ([0-9a-fA-F]{64})\$/\\1/p" | head -n1
}

detect_platform() {
  local os arch

  case "$(uname -s)" in
    Linux*)  os="linux" ;;
    Darwin*) os="darwin" ;;
    *) echo "Unsupported OS: $(uname -s)"; exit 0 ;;
  esac

  case "$(uname -m)" in
    x86_64|amd64) arch="amd64" ;;
    aarch64|arm64) arch="arm64" ;;
    *) echo "Unsupported architecture: $(uname -m)"; exit 0 ;;
  esac

  echo "${os}-${arch}"
}

restart_daemon() {
  if [ "$(uname -s)" = "Linux" ] && command -v systemctl >/dev/null 2>&1; then
    if systemctl --user is-enabled loopwired.service >/dev/null 2>&1; then
      systemctl --user restart loopwired.service >/dev/null 2>&1 || true
      return
    fi
  fi

  if [ "$(uname -s)" = "Darwin" ] && command -v launchctl >/dev/null 2>&1; then
    launchctl kickstart -k "gui/$(id -u)/dev.loopwire.loopwired" >/dev/null 2>&1 || true
    return
  fi

  "${INSTALL_DIR}/${BINARY_NAME}" stop >/dev/null 2>&1 || true
  LOOPWIRE_FRONTEND_URL="${FRONTEND_URL}" "${INSTALL_DIR}/${BINARY_NAME}" start >/dev/null 2>&1 || true
}

PLATFORM="$(detect_platform)"
LATEST_TAG="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | cut -d'"' -f4 || true)"
[ -n "${LATEST_TAG}" ] || exit 0

DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${LATEST_TAG}/loopwired-${PLATFORM}"
CHECKSUM_URL="https://github.com/${REPO}/releases/download/${LATEST_TAG}/checksums.sha256"
INSTALLED_PATH="${INSTALL_DIR}/${BINARY_NAME}"
TMP_PATH="${INSTALL_DIR}/${BINARY_NAME}.tmp"

mkdir -p "${INSTALL_DIR}"
curl -fsSL "${DOWNLOAD_URL}" -o "${TMP_PATH}"

CHECKSUMS="$(curl -fsSL "${CHECKSUM_URL}")"
EXPECTED="$(extract_expected_checksum "${CHECKSUMS}" "loopwired-${PLATFORM}")"
[ -n "${EXPECTED}" ] || { rm -f "${TMP_PATH}"; exit 1; }
ACTUAL_TMP="$(sha256_file "${TMP_PATH}")"
[ "${EXPECTED}" = "${ACTUAL_TMP}" ] || { rm -f "${TMP_PATH}"; exit 1; }

if [ -f "${INSTALLED_PATH}" ]; then
  ACTUAL_INSTALLED="$(sha256_file "${INSTALLED_PATH}")"
  if [ "${ACTUAL_INSTALLED}" = "${ACTUAL_TMP}" ]; then
    rm -f "${TMP_PATH}"
    exit 0
  fi
fi

chmod +x "${TMP_PATH}"
mv "${TMP_PATH}" "${INSTALLED_PATH}"
restart_daemon
EOF

  chmod +x "$updater_path"
  :
}

register_autoupdate_macos() {
  local updater_path="$1"
  local plist_dir="$HOME/Library/LaunchAgents"
  local plist_path="$plist_dir/dev.loopwire.loopwired.autoupdate.plist"

  mkdir -p "$plist_dir"

  cat > "$plist_path" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>dev.loopwire.loopwired.autoupdate</string>
  <key>ProgramArguments</key>
  <array>
    <string>${updater_path}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>86400</integer>
  <key>StandardOutPath</key>
  <string>${HOME}/.loopwire/loopwired-autoupdate.out.log</string>
  <key>StandardErrorPath</key>
  <string>${HOME}/.loopwire/loopwired-autoupdate.err.log</string>
</dict>
</plist>
EOF

  if launchctl list | grep -q "dev.loopwire.loopwired.autoupdate"; then
    launchctl unload "$plist_path" >/dev/null 2>&1 || true
  fi

  launchctl load -w "$plist_path" >/dev/null 2>&1 || true
  :
}

register_autoupdate_linux() {
  local updater_path="$1"
  local unit_dir="$HOME/.config/systemd/user"
  local service_path="$unit_dir/${AUTOUPDATE_NAME}.service"
  local timer_path="$unit_dir/${AUTOUPDATE_NAME}.timer"

  if ! command -v systemctl >/dev/null 2>&1; then
    echo "systemctl not found; skipping auto-update registration."
    return
  fi

  mkdir -p "$unit_dir"

  cat > "$service_path" <<EOF
[Unit]
Description=Loopwire daemon auto-update

[Service]
Type=oneshot
ExecStart=${updater_path}
EOF

  cat > "$timer_path" <<EOF
[Unit]
Description=Run Loopwire daemon auto-update daily

[Timer]
OnBootSec=10m
OnUnitActiveSec=24h
Persistent=true

[Install]
WantedBy=timers.target
EOF

  systemctl --user daemon-reload
  systemctl --user enable --now "${AUTOUPDATE_NAME}.timer" >/dev/null 2>&1 || {
    echo "Could not enable auto-update timer automatically."
    echo "Try manually:"
    echo "  systemctl --user daemon-reload"
    echo "  systemctl --user enable --now ${AUTOUPDATE_NAME}.timer"
    return
  }

  :
}

is_autostart_enabled() {
  case "$(uname -s)" in
    Darwin*)
      local plist_path="$HOME/Library/LaunchAgents/dev.loopwire.loopwired.plist"
      if [ -f "$plist_path" ]; then
        return 0
      fi
      launchctl list | grep -q "dev.loopwire.loopwired"
      ;;
    Linux*)
      if ! command -v systemctl >/dev/null 2>&1; then
        return 1
      fi
      systemctl --user is-enabled "${AUTOSTART_NAME}.service" >/dev/null 2>&1
      ;;
    *)
      return 1
      ;;
  esac
}

is_autoupdate_enabled() {
  case "$(uname -s)" in
    Darwin*)
      local plist_path="$HOME/Library/LaunchAgents/dev.loopwire.loopwired.autoupdate.plist"
      if [ -f "$plist_path" ]; then
        return 0
      fi
      launchctl list | grep -q "dev.loopwire.loopwired.autoupdate"
      ;;
    Linux*)
      if ! command -v systemctl >/dev/null 2>&1; then
        return 1
      fi
      systemctl --user is-enabled "${AUTOUPDATE_NAME}.timer" >/dev/null 2>&1
      ;;
    *)
      return 1
      ;;
  esac
}

uninstall_macos_services() {
  local autostart_plist="$HOME/Library/LaunchAgents/dev.loopwire.loopwired.plist"
  local autoupdate_plist="$HOME/Library/LaunchAgents/dev.loopwire.loopwired.autoupdate.plist"

  launchctl unload "$autostart_plist" >/dev/null 2>&1 || true
  launchctl unload "$autoupdate_plist" >/dev/null 2>&1 || true
  rm -f "$autostart_plist" "$autoupdate_plist"
}

uninstall_linux_services() {
  local unit_dir="$HOME/.config/systemd/user"
  local service_path="$unit_dir/${AUTOSTART_NAME}.service"
  local timer_service="$unit_dir/${AUTOUPDATE_NAME}.service"
  local timer_path="$unit_dir/${AUTOUPDATE_NAME}.timer"

  if command -v systemctl >/dev/null 2>&1; then
    systemctl --user disable --now "${AUTOSTART_NAME}.service" >/dev/null 2>&1 || true
    systemctl --user disable --now "${AUTOUPDATE_NAME}.timer" >/dev/null 2>&1 || true
    systemctl --user daemon-reload >/dev/null 2>&1 || true
  fi

  rm -f "$service_path" "$timer_service" "$timer_path"
}

stop_daemon_if_running() {
  local pid_file="${HOME}/.loopwire/loopwired.pid"
  local did_stop=0

  if [ -f "$pid_file" ]; then
    local pid
    pid="$(tr -d '\r\n' < "$pid_file")"
    if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" >/dev/null 2>&1; then
      kill -9 "$pid" >/dev/null 2>&1 || true
      did_stop=1
    fi
  fi

  # Fallback: if a stale/missing PID file was present, ensure no daemon process remains.
  if command -v pkill >/dev/null 2>&1; then
    pkill -9 -f '/\.loopwire/bin/loopwired' >/dev/null 2>&1 || true
  fi

  rm -f "$pid_file" >/dev/null 2>&1 || true
  if [ "$did_stop" -eq 1 ]; then
    return 0
  fi
  return 1
}

run_uninstall() {
  local shell_profile
  shell_profile="$(detect_shell_profile)"
  local binary_path="${INSTALL_DIR}/loopwired"
  local updater_path="${INSTALL_DIR}/loopwire-autoupdate"
  local config_root="${HOME}/.loopwire"

  echo ""
  if [ "$DRY_RUN" -eq 1 ]; then
    log_section "🧪 Plan"
    log_step "Dry-run enabled. No changes will be made."
    echo "📝 Remove auto-start at login."
    echo "📝 Remove auto-update."
    echo "📝 Remove loopwired binary."
    if [ "$PURGE_DATA" -eq 1 ]; then
      echo "📝 Remove local data."
    else
      echo "📝 Keep local data (use --purge-data to remove it)."
    fi
    log_section "✅ Success"
    log_ok "Dry-run complete."
    exit 0
  fi

  log_section "🗑️  Removal"
  log_step "Uninstalling loopwired..."

  case "$(uname -s)" in
    Darwin*)
      uninstall_macos_services
      log_ok "Auto-start at login removed."
      log_ok "Auto-update removed."
      ;;
    Linux*)
      uninstall_linux_services
      log_ok "Auto-start at login removed."
      log_ok "Auto-update removed."
      ;;
    *) ;;
  esac

  if stop_daemon_if_running; then
    log_ok "Daemon stopped."
  fi

  rm -f "$binary_path" "$updater_path"
  log_ok "loopwired binary removed."

  if [ -n "$shell_profile" ]; then
    remove_path_from_profile "$shell_profile"
  fi

  rmdir "$INSTALL_DIR" >/dev/null 2>&1 || true

  if [ "$PURGE_DATA" -eq 1 ]; then
    rm -rf "$config_root"
    log_ok "Local data removed."
  else
    log_warn "Local data kept. Use --purge-data to remove it."
  fi

  log_section "✅ Success"
  echo "😔 Uninstall complete."
  echo "We hope to see you back soon."
  exit 0
}

parse_args "$@"
PLATFORM=$(detect_platform)
print_header
log_info "Platform: $PLATFORM"

if [ "$UNINSTALL" -eq 1 ]; then
  run_uninstall
fi

# Get latest release tag
if [ "$DRY_RUN" -eq 1 ]; then
  LATEST_TAG="$(curl -sL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | cut -d'"' -f4 || true)"
  if [ -z "$LATEST_TAG" ]; then
    LATEST_TAG="<latest-release-tag>"
    log_warn "Could not fetch latest release tag (offline or API unreachable)."
  fi
else
  LATEST_TAG="$(curl -sL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | cut -d'"' -f4)"
  if [ -z "$LATEST_TAG" ]; then
    echo "❌ Could not fetch latest release."
    echo "Check your internet connection and retry."
    exit 1
  fi
fi
log_info "Release: $LATEST_TAG"

# Download binary
BINARY_NAME="loopwired"

DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${LATEST_TAG}/loopwired-${PLATFORM}"
CHECKSUM_URL="https://github.com/${REPO}/releases/download/${LATEST_TAG}/checksums.sha256"

if [ "$DRY_RUN" -eq 1 ]; then
  log_section "🧪 Plan"
  log_step "Dry-run enabled. No changes will be made."
  echo "📝 Install or update loopwired binary."
  echo "📝 Ensure command is available in your shell."
  echo "📝 Configure auto-start at login."
  echo "📝 Configure auto-update."
  echo "📝 Open app with one-click token URL."
  log_section "✅ Success"
  log_ok "Dry-run complete."
  echo "🌐 Open: $(build_tokenized_url "${FRONTEND_URL}" "<bootstrap-token>")"
  exit 0
fi

log_section "📦 Install"
if [ -f "${INSTALL_DIR}/${BINARY_NAME}" ]; then
  log_step "Checking loopwired version..."
else
  log_step "Installing loopwired..."
fi
mkdir -p "$INSTALL_DIR"
CHECKSUMS="$(curl -sL "$CHECKSUM_URL")"
EXPECTED="$(extract_expected_checksum "${CHECKSUMS}" "loopwired-${PLATFORM}")"
if [ -z "$EXPECTED" ]; then
  echo "❌ Download verification failed."
  echo "Try again in a minute. If it repeats, open an issue."
  exit 1
fi

SKIP_BINARY_INSTALL=0
BINARY_CHANGED=0
if [ -f "${INSTALL_DIR}/${BINARY_NAME}" ]; then
  INSTALLED_HASH="$(sha256_file "${INSTALL_DIR}/${BINARY_NAME}")"
  if [ "${INSTALLED_HASH}" = "${EXPECTED}" ]; then
    SKIP_BINARY_INSTALL=1
    log_ok "loopwired already up to date."
  fi
fi

if [ "${SKIP_BINARY_INSTALL}" -eq 0 ]; then
  log_step "Downloading loopwired binary..."
  curl -sL "$DOWNLOAD_URL" -o "${INSTALL_DIR}/${BINARY_NAME}"
  log_step "Verifying downloaded binary..."
  ACTUAL="$(sha256_file "${INSTALL_DIR}/${BINARY_NAME}")"

  if [ "$EXPECTED" != "$ACTUAL" ]; then
    echo "❌ Download verification failed."
    echo "Try again in a minute. If it repeats, open an issue."
    rm -f "${INSTALL_DIR}/${BINARY_NAME}"
    exit 1
  fi

  # Set permissions
  chmod +x "${INSTALL_DIR}/${BINARY_NAME}"
  BINARY_CHANGED=1
else
  chmod +x "${INSTALL_DIR}/${BINARY_NAME}" || true
fi

if [ "${BINARY_CHANGED}" -eq 1 ]; then
  log_ok "loopwired installed."
fi

# Add to shell profile if not already there
SHELL_PROFILE="$(detect_shell_profile)"

if [ -n "$SHELL_PROFILE" ]; then
  if ! grep -qF "${INSTALL_DIR}" "$SHELL_PROFILE" 2>/dev/null; then
    echo "" >> "$SHELL_PROFILE"
    echo "# Loopwire" >> "$SHELL_PROFILE"
    case "${SHELL:-}" in
      */fish) echo "fish_add_path -m \"${INSTALL_DIR}\"" >> "$SHELL_PROFILE" ;;
      *) echo "export PATH=\"${INSTALL_DIR}:\$PATH\"" >> "$SHELL_PROFILE" ;;
    esac
    log_ok "Command available in your shell."
  fi
else
  log_warn "Add ~/.loopwire/bin to your PATH."
fi

# Ensure install dir is on PATH for this session
export PATH="${INSTALL_DIR}:$PATH"

FULL_BINARY_PATH="${INSTALL_DIR}/${BINARY_NAME}"
UPDATER_PATH="${INSTALL_DIR}/loopwire-autoupdate"
log_step "Configuring background services..."

# Register auto-start based on OS
if [[ "$(uname -s)" == "Darwin" || "$(uname -s)" == "Linux" ]]; then
  if is_autostart_enabled; then
    log_ok "Auto-start at login already enabled."
  else
    case "$(uname -s)" in
      Darwin*)
        register_autostart_macos "$FULL_BINARY_PATH"
        ;;
      Linux*)
        register_autostart_linux "$FULL_BINARY_PATH"
        ;;
    esac
    if is_autostart_enabled; then
      log_ok "Auto-start at login enabled."
    else
      log_warn "Could not enable auto-start at login."
    fi
  fi
else
  log_warn "Auto-start at login not available on this OS."
fi

# Register auto-update based on OS
if [[ "$(uname -s)" == "Darwin" || "$(uname -s)" == "Linux" ]]; then
  if is_autoupdate_enabled && [ -x "$UPDATER_PATH" ]; then
    log_ok "Auto-update already enabled."
  else
    install_autoupdate_script
    case "$(uname -s)" in
      Darwin*)
        register_autoupdate_macos "$UPDATER_PATH"
        ;;
      Linux*)
        register_autoupdate_linux "$UPDATER_PATH"
        ;;
    esac
    if is_autoupdate_enabled; then
      log_ok "Auto-update enabled."
    else
      log_warn "Could not enable auto-update."
    fi
  fi
else
  log_warn "Auto-update not available on this OS."
fi

# Start the daemon only when no OS service manager handles startup.
case "$(uname -s)" in
  Darwin*|Linux*)
    sleep 1
    ;;
  *)
    if "${FULL_BINARY_PATH}" status 2>/dev/null | grep -q "Daemon is running"; then
      log_ok "loopwired is already running."
    else
      log_step "Starting loopwired..."
      LOOPWIRE_FRONTEND_URL="${FRONTEND_URL}" "${FULL_BINARY_PATH}" start >/dev/null 2>&1 &
      DAEMON_PID=$!

      sleep 1
      if kill -0 "$DAEMON_PID" 2>/dev/null; then
        log_ok "loopwired is running (PID ${DAEMON_PID})."
      else
        log_warn "loopwired may already be managed by your OS service or exited unexpectedly."
        log_warn "Run 'loopwired status' to verify."
      fi
    fi
    ;;
esac

log_section "✅ Success"
echo "🎉 Loopwire is ready"
BOOTSTRAP_TOKEN="$(read_bootstrap_token || true)"
if [ -n "${BOOTSTRAP_TOKEN}" ]; then
  echo "🌐 Open: $(build_tokenized_url "${FRONTEND_URL}" "${BOOTSTRAP_TOKEN}")"
else
  echo "🌐 Open: ${FRONTEND_URL}/"
fi
