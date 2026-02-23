#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

DAEMON_TARGETS=()

for arg in "$@"; do
  case "$arg" in
    --daemon-target=*)
      DAEMON_TARGETS+=("${arg#*=}")
      ;;
    *)
      echo "Unknown argument: $arg"
      echo "Usage: scripts/check-daemon-builds.sh [--daemon-target=<triple>]"
      exit 1
      ;;
  esac
done

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd"
    exit 1
  fi
}

docker_linux_build() {
  local target="$1"
  require_cmd docker

  echo "[daemon-build-check] using Docker fallback for target: $target"
  docker run --rm --platform=linux/amd64 \
    -v "$ROOT_DIR":/work \
    -w /work/apps/daemon \
    ubuntu:24.04 bash -lc "
      set -euo pipefail
      export DEBIAN_FRONTEND=noninteractive

      apt-get update
      apt-get install -y curl ca-certificates gnupg build-essential pkg-config libssl-dev git

      if [[ \"$target\" == \"aarch64-unknown-linux-gnu\" ]]; then
        dpkg --add-architecture arm64
        # Keep default Ubuntu sources on amd64 to avoid arm64 lookups on archive/security mirrors.
        if [[ -f /etc/apt/sources.list.d/ubuntu.sources ]]; then
          sed -i '/^Architectures:/d' /etc/apt/sources.list.d/ubuntu.sources
          sed -i '/^Signed-By:/a Architectures: amd64' /etc/apt/sources.list.d/ubuntu.sources
        fi
        if [[ -f /etc/apt/sources.list ]]; then
          sed -i -E 's/^deb[[:space:]]+http:\/\/(archive|security)\.ubuntu\.com\/ubuntu/deb [arch=amd64] http:\/\/\1.ubuntu.com\/ubuntu/g' /etc/apt/sources.list
        fi
        cat <<'EOF' >/etc/apt/sources.list.d/ubuntu-ports-arm64.list
deb [arch=arm64] http://ports.ubuntu.com/ubuntu-ports noble main restricted universe multiverse
deb [arch=arm64] http://ports.ubuntu.com/ubuntu-ports noble-updates main restricted universe multiverse
deb [arch=arm64] http://ports.ubuntu.com/ubuntu-ports noble-backports main restricted universe multiverse
deb [arch=arm64] http://ports.ubuntu.com/ubuntu-ports noble-security main restricted universe multiverse
EOF
        apt-get update
        apt-get install -y gcc-aarch64-linux-gnu libc6-dev-arm64-cross libssl-dev:arm64
      fi

      curl https://sh.rustup.rs -sSf | sh -s -- -y --profile minimal --default-toolchain 1.93.0
      source /root/.cargo/env
      rustup target add \"$target\"

      if [[ \"$target\" == \"aarch64-unknown-linux-gnu\" ]]; then
        export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=aarch64-linux-gnu-gcc
        export PKG_CONFIG_ALLOW_CROSS=1
        export PKG_CONFIG_SYSROOT_DIR=/
        export PKG_CONFIG_PATH=/usr/lib/aarch64-linux-gnu/pkgconfig:/usr/share/pkgconfig
        export OPENSSL_LIB_DIR=/usr/lib/aarch64-linux-gnu
        export OPENSSL_INCLUDE_DIR=/usr/include
      fi

      cargo build --release --target \"$target\"
    "
}

echo "[daemon-build-check] starting"

require_cmd cargo
require_cmd rustup

host_target="$(rustc -vV | awk '/^host:/ {print $2}')"
host_os="$(uname -s)"

if [[ ${#DAEMON_TARGETS[@]} -eq 0 ]]; then
  DAEMON_TARGETS+=("$host_target")
fi

daemon_toolchain="$(
  cd "$ROOT_DIR/apps/daemon"
  rustup show active-toolchain | awk '{print $1}'
)"

if [[ -z "$daemon_toolchain" ]]; then
  echo "[daemon-build-check] unable to determine daemon Rust toolchain"
  exit 1
fi

echo "[daemon-build-check] using daemon toolchain: $daemon_toolchain"
echo "[daemon-build-check] running daemon build checks for targets: ${DAEMON_TARGETS[*]}"

for target in "${DAEMON_TARGETS[@]}"; do
  if [[ "$host_os" == "Darwin" && "$target" == *"-unknown-linux-gnu" ]]; then
    docker_linux_build "$target"
    continue
  fi

  if [[ "$host_os" == "Linux" && "$target" == *"-apple-darwin" ]]; then
    echo "[daemon-build-check] target $target is not supported from Linux host."
    echo "[daemon-build-check] Darwin targets must be validated on macOS CI runners."
    exit 2
  fi

  if ! rustup target list --installed --toolchain "$daemon_toolchain" | grep -qx "$target"; then
    rustup target add --toolchain "$daemon_toolchain" "$target"
  fi

  echo "[daemon-build-check] building daemon for target: $target"
  (
    cd "$ROOT_DIR/apps/daemon"
    cargo build --release --target "$target"
  )
done

echo "[daemon-build-check] all requested checks passed"
