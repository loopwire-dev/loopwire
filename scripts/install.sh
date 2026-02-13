#!/usr/bin/env bash
set -euo pipefail

REPO="loopwire/loopwire"
INSTALL_DIR="${HOME}/.loopwire/bin"

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

# Check if in PATH
if ! echo "$PATH" | tr ':' '\n' | grep -q "${INSTALL_DIR}"; then
  echo "Add the following to your shell profile:"
  echo ""
  echo "  export PATH=\"${INSTALL_DIR}:\$PATH\""
  echo ""
fi

echo "Run 'loopwired start' to start the daemon."
