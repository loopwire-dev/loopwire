#!/usr/bin/env bash
set -euo pipefail

REPO="loopwire-dev/loopwire"
INSTALL_DIR="${HOME}/.loopwire/bin"
AUTOSTART_NAME="loopwired"
AUTOUPDATE_NAME="loopwired-autoupdate"

# Detect OS and architecture
detect_platform() {
  local os arch

  case "$(uname -s)" in
    Linux*)  os="linux" ;;
    Darwin*) os="darwin" ;;
    MINGW*|MSYS*|CYGWIN*) os="windows" ;;
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
  launchctl start dev.loopwire.loopwired >/dev/null 2>&1 || true

  echo "Auto-start enabled via launchd: $plist_path"
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

  echo "Auto-start enabled via systemd user service: $unit_path"
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

detect_platform() {
  local os arch

  case "$(uname -s)" in
    Linux*)  os="linux" ;;
    Darwin*) os="darwin" ;;
    MINGW*|MSYS*|CYGWIN*) os="windows" ;;
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
  "${INSTALL_DIR}/${BINARY_NAME}" start >/dev/null 2>&1 || true
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
EXPECTED="$(echo "${CHECKSUMS}" | grep "loopwired-${PLATFORM}" | awk '{print $1}')"
ACTUAL_TMP="$(shasum -a 256 "${TMP_PATH}" | awk '{print $1}')"
[ "${EXPECTED}" = "${ACTUAL_TMP}" ] || { rm -f "${TMP_PATH}"; exit 1; }

if [ -f "${INSTALLED_PATH}" ]; then
  ACTUAL_INSTALLED="$(shasum -a 256 "${INSTALLED_PATH}" | awk '{print $1}')"
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
  echo "Installed auto-update helper: $updater_path"
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
  echo "Auto-update enabled via launchd: $plist_path"
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

  echo "Auto-update enabled via systemd user timer: $timer_path"
}

PLATFORM=$(detect_platform)
echo "Detected platform: $PLATFORM"

# Get latest release tag
LATEST_TAG=$(curl -sL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | cut -d'"' -f4)
if [ -z "$LATEST_TAG" ]; then
  echo "Could not determine latest release. Check https://github.com/${REPO}/releases"
  exit 1
fi
echo "Latest release: $LATEST_TAG"

# Download binary
BINARY_NAME="loopwired"
if [ "$PLATFORM" = "windows-amd64" ]; then
  BINARY_NAME="loopwired.exe"
fi

DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${LATEST_TAG}/loopwired-${PLATFORM}"
CHECKSUM_URL="https://github.com/${REPO}/releases/download/${LATEST_TAG}/checksums.sha256"

echo "Downloading loopwired..."
mkdir -p "$INSTALL_DIR"
curl -sL "$DOWNLOAD_URL" -o "${INSTALL_DIR}/${BINARY_NAME}"

# Download and verify checksum
echo "Verifying checksum..."
CHECKSUMS=$(curl -sL "$CHECKSUM_URL")
EXPECTED=$(echo "$CHECKSUMS" | grep "loopwired-${PLATFORM}" | awk '{print $1}')
ACTUAL=$(shasum -a 256 "${INSTALL_DIR}/${BINARY_NAME}" | awk '{print $1}')

if [ "$EXPECTED" != "$ACTUAL" ]; then
  echo "Checksum verification FAILED!"
  echo "  Expected: $EXPECTED"
  echo "  Got:      $ACTUAL"
  rm -f "${INSTALL_DIR}/${BINARY_NAME}"
  exit 1
fi
echo "Checksum verified."

# Set permissions
chmod +x "${INSTALL_DIR}/${BINARY_NAME}"

echo ""
echo "Installed loopwired to ${INSTALL_DIR}/${BINARY_NAME}"
echo ""

# Ensure install dir is on PATH for this session
export PATH="${INSTALL_DIR}:$PATH"

# Add to shell profile if not already there
if ! echo "$PATH" | tr ':' '\n' | grep -q "${INSTALL_DIR}"; then
  SHELL_PROFILE=""
  case "${SHELL:-}" in
    */zsh)  SHELL_PROFILE="$HOME/.zshrc" ;;
    */bash)
      if [ -f "$HOME/.bash_profile" ]; then
        SHELL_PROFILE="$HOME/.bash_profile"
      else
        SHELL_PROFILE="$HOME/.bashrc"
      fi
      ;;
    */fish) SHELL_PROFILE="$HOME/.config/fish/config.fish" ;;
  esac

  if [ -n "$SHELL_PROFILE" ]; then
    echo "" >> "$SHELL_PROFILE"
    echo "# Loopwire" >> "$SHELL_PROFILE"
    echo "export PATH=\"${INSTALL_DIR}:\$PATH\"" >> "$SHELL_PROFILE"
    echo "Added ${INSTALL_DIR} to PATH in ${SHELL_PROFILE}"
  else
    echo "Add the following to your shell profile:"
    echo ""
    echo "  export PATH=\"${INSTALL_DIR}:\$PATH\""
    echo ""
  fi
fi

FULL_BINARY_PATH="${INSTALL_DIR}/${BINARY_NAME}"
UPDATER_PATH="${INSTALL_DIR}/loopwire-autoupdate"

# Register auto-start based on OS
case "$(uname -s)" in
  Darwin*)
    register_autostart_macos "$FULL_BINARY_PATH"
    ;;
  Linux*)
    register_autostart_linux "$FULL_BINARY_PATH"
    ;;
  *)
    echo "Auto-start registration is not configured for this OS yet."
    ;;
esac

# Register auto-update based on OS
install_autoupdate_script
case "$(uname -s)" in
  Darwin*)
    register_autoupdate_macos "$UPDATER_PATH"
    ;;
  Linux*)
    register_autoupdate_linux "$UPDATER_PATH"
    ;;
  *)
    echo "Auto-update registration is not configured for this OS yet."
    ;;
esac

# Start the daemon immediately if not already running.
if "${FULL_BINARY_PATH}" status 2>/dev/null | grep -q "Daemon is running"; then
  echo "loopwired is already running."
else
  echo "Starting loopwired..."
  "${FULL_BINARY_PATH}" start &
  DAEMON_PID=$!

  sleep 1
  if kill -0 "$DAEMON_PID" 2>/dev/null; then
    echo "loopwired is running (PID ${DAEMON_PID})."
  else
    echo "Warning: loopwired may already be managed by your OS service or exited unexpectedly."
    echo "Run 'loopwired status' to verify."
  fi
fi
