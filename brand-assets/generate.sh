#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${ROOT_DIR}/.." && pwd)"
DEFAULT_SRC="${REPO_ROOT}/apps/web/src/assets/images/logo.svg"
SRC_INPUT="${1:-${DEFAULT_SRC}}"

if [ -f "${SRC_INPUT}" ]; then
  SRC_FILE="${SRC_INPUT}"
elif [ -f "${REPO_ROOT}/${SRC_INPUT}" ]; then
  SRC_FILE="${REPO_ROOT}/${SRC_INPUT}"
else
  echo "Source logo not found: ${SRC_INPUT}" >&2
  exit 1
fi

if ! command -v magick >/dev/null 2>&1; then
  echo "ImageMagick (magick) is required but not installed." >&2
  exit 1
fi

OUT="${ROOT_DIR}"
mkdir -p \
  "${OUT}/source" \
  "${OUT}/vector" \
  "${OUT}/png" \
  "${OUT}/favicon" \
  "${OUT}/app-icons" \
  "${OUT}/social"

cp "${SRC_FILE}" "${OUT}/source/logo.svg"
cp "${SRC_FILE}" "${OUT}/vector/logo-black.svg"
cp "${SRC_FILE}" "${OUT}/favicon/favicon.svg"
sed 's/fill="black"/fill="white"/g' "${SRC_FILE}" > "${OUT}/vector/logo-white.svg"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT
# Keep font cache writes inside a writable temp location.
export XDG_CACHE_HOME="${TMP_DIR}"

# Use Figtree brand wordmark style in social cards.
AVAILABLE_FONTS="$(magick -list font 2>/dev/null || true)"
REQUESTED_TITLE_FONT="${TITLE_FONT:-}"
REQUESTED_TITLE_FONT_FILE="${TITLE_FONT_FILE:-}"
FIGTREE_FONT_FILE="${OUT}/fonts/Figtree-VariableFont_wght.ttf"
FONTSOURCE_FIGTREE_BOLD_FILE="${REPO_ROOT}/node_modules/@fontsource/figtree/files/figtree-latin-700-normal.woff"
TITLE_FONT="Helvetica-Bold"
TITLE_FONT_FILE=""

if [ -n "${REQUESTED_TITLE_FONT_FILE}" ] && [ -f "${REQUESTED_TITLE_FONT_FILE}" ]; then
  TITLE_FONT_FILE="${REQUESTED_TITLE_FONT_FILE}"
else
  if [ -n "${REQUESTED_TITLE_FONT}" ] && grep -Fq "Font: ${REQUESTED_TITLE_FONT}" <<<"${AVAILABLE_FONTS}"; then
    TITLE_FONT="${REQUESTED_TITLE_FONT}"
  elif [ -f "${FONTSOURCE_FIGTREE_BOLD_FILE}" ]; then
    TITLE_FONT_FILE="${FONTSOURCE_FIGTREE_BOLD_FILE}"
  elif grep -Fq "Font: Figtree-Bold" <<<"${AVAILABLE_FONTS}"; then
    TITLE_FONT="Figtree-Bold"
  elif grep -Fq "Font: Figtree-ExtraBold" <<<"${AVAILABLE_FONTS}"; then
    TITLE_FONT="Figtree-ExtraBold"
  elif grep -Fq "Font: Figtree-SemiBold" <<<"${AVAILABLE_FONTS}"; then
    TITLE_FONT="Figtree-SemiBold"
  elif grep -Fq "Font: Figtree-Medium" <<<"${AVAILABLE_FONTS}"; then
    TITLE_FONT="Figtree-Medium"
  elif grep -Fq "Font: Figtree" <<<"${AVAILABLE_FONTS}"; then
    TITLE_FONT="Figtree"
  elif grep -Fq "Font: Figtree-Regular" <<<"${AVAILABLE_FONTS}"; then
    TITLE_FONT="Figtree-Regular"
  elif [ -f "${FIGTREE_FONT_FILE}" ]; then
    TITLE_FONT_FILE="${FIGTREE_FONT_FILE}"
  else
    echo "Figtree font not found. Add ${FIGTREE_FONT_FILE} (or set TITLE_FONT_FILE) to use Figtree; using fallback." >&2
    if [ -n "${REQUESTED_TITLE_FONT}" ]; then
      echo "Requested TITLE_FONT not found: ${REQUESTED_TITLE_FONT}; using best available fallback." >&2
    fi
    for candidate in \
      "Helvetica-Bold" \
      "HelveticaNeue-Bold" \
      "Arial-BoldMT" \
      "DIN-Condensed-Bold" \
      "Futura-Bold" \
      "Impact"; do
      if grep -Fq "Font: ${candidate}" <<<"${AVAILABLE_FONTS}"; then
        TITLE_FONT="${candidate}"
        break
      fi
    done
  fi
fi

if [ -n "${TITLE_FONT_FILE}" ]; then
  echo "Using social title font file: ${TITLE_FONT_FILE}"
else
  echo "Using social title font: ${TITLE_FONT}"
fi

# Tailwind's tracking-tight is -0.025em.
TRACKING_TIGHT_EM="-0.025"
OG_TITLE_POINTSIZE=128
TWITTER_TITLE_POINTSIZE=120
OG_TITLE_KERNING="$(awk "BEGIN { printf \"%.2f\", ${TRACKING_TIGHT_EM} * ${OG_TITLE_POINTSIZE} }")"
TWITTER_TITLE_KERNING="$(awk "BEGIN { printf \"%.2f\", ${TRACKING_TIGHT_EM} * ${TWITTER_TITLE_POINTSIZE} }")"

# Full-size master render.
magick -background none -density 2048 "${SRC_FILE}" -resize 4096x4096 "${TMP_DIR}/logo-master.png"

# Padded icon masters for icon-safe area usage.
magick -background none -density 2048 "${SRC_FILE}" -resize 820x820 -gravity center -extent 1024x1024 "${TMP_DIR}/logo-padded-black-1024.png"
magick -background none -density 2048 "${OUT}/vector/logo-white.svg" -resize 820x820 -gravity center -extent 1024x1024 "${TMP_DIR}/logo-padded-white-1024.png"

# Transparent PNG exports for general usage.
for size in 16 24 32 48 64 96 128 180 192 256 384 512 1024 2048 4096; do
  magick "${TMP_DIR}/logo-master.png" -resize "${size}x${size}" "${OUT}/png/logo-${size}.png"
done

# Favicons.
for size in 16 32 48; do
  magick "${TMP_DIR}/logo-padded-black-1024.png" -resize "${size}x${size}" "${OUT}/favicon/favicon-${size}x${size}.png"
done
magick "${TMP_DIR}/logo-padded-black-1024.png" -define icon:auto-resize=16,24,32,48,64 "${OUT}/favicon/favicon.ico"

# Solid background icon base for PWA/app stores.
magick -size 1024x1024 xc:white "${TMP_DIR}/logo-padded-black-1024.png" -gravity center -composite "${OUT}/app-icons/icon-base-1024.png"
magick "${OUT}/app-icons/icon-base-1024.png" -resize 512x512 "${OUT}/app-icons/android-chrome-512x512.png"
magick "${OUT}/app-icons/icon-base-1024.png" -resize 192x192 "${OUT}/app-icons/android-chrome-192x192.png"
magick "${OUT}/app-icons/icon-base-1024.png" -resize 180x180 "${OUT}/app-icons/apple-touch-icon.png"
magick "${OUT}/app-icons/icon-base-1024.png" -resize 150x150 "${OUT}/app-icons/mstile-150x150.png"
magick "${OUT}/app-icons/icon-base-1024.png" -resize 512x512 "${OUT}/app-icons/maskable-icon-512x512.png"

# Social cards.
# Keep shared geometry between light/dark variants for symmetry.
SOFT_BLACK_BG="#171717"
ACCENT_BG="#0f8577"
ACCENT_HOVER_BG="#0d7367"

OG_WIDTH=1200
OG_HEIGHT=630
OG_LOGO_SIZE=280
OG_LOGO_TEXT_GAP=60

TWITTER_WIDTH=1200
TWITTER_HEIGHT=600
TWITTER_LOGO_SIZE=260
TWITTER_LOGO_TEXT_GAP=60

render_social_card() {
  local output_path="$1"
  local width="$2"
  local height="$3"
  local bg="$4"
  local logo_path="$5"
  local logo_size="$6"
  local logo_text_gap="$7"
  local title_fill="$8"
  local title_pointsize="$9"
  local title_kerning="${10}"

  local text_img="${TMP_DIR}/social-text-${title_fill//[^a-zA-Z0-9]/_}-${title_pointsize}.png"
  local logo_img="${TMP_DIR}/social-logo-${logo_size}.png"
  local group_img="${TMP_DIR}/social-group-${width}x${height}-${logo_size}-${title_pointsize}.png"
  local text_w
  local text_h
  local logo_w
  local logo_h
  local group_w
  local group_h
  local logo_y
  local text_x
  local text_y

  magick -background none -fill "${title_fill}" -font "${TITLE_FONT_FILE:-${TITLE_FONT}}" -kerning "${title_kerning}" -pointsize "${title_pointsize}" \
    label:"Loopwire" "${text_img}"
  text_w="$(identify -format "%w" "${text_img}")"
  text_h="$(identify -format "%h" "${text_img}")"

  magick "${logo_path}" -resize "${logo_size}x${logo_size}" -trim +repage "${logo_img}"
  logo_w="$(identify -format "%w" "${logo_img}")"
  logo_h="$(identify -format "%h" "${logo_img}")"

  group_w="$((logo_w + logo_text_gap + text_w))"
  if [ "${logo_h}" -gt "${text_h}" ]; then
    group_h="${logo_h}"
  else
    group_h="${text_h}"
  fi
  logo_y="$(((group_h - logo_h) / 2))"
  text_x="$((logo_w + logo_text_gap))"
  text_y="$(((group_h - text_h) / 2))"

  magick -size "${group_w}x${group_h}" xc:none \
    "${logo_img}" -geometry "+0+${logo_y}" -composite \
    "${text_img}" -geometry "+${text_x}+${text_y}" -composite \
    "${group_img}"

  magick -size "${width}x${height}" "xc:${bg}" \
    "${group_img}" -gravity center -composite \
    "${output_path}"
}

render_social_card "${OUT}/social/og-image-1200x630.png" \
  "${OG_WIDTH}" "${OG_HEIGHT}" "white" \
  "${TMP_DIR}/logo-padded-black-1024.png" "${OG_LOGO_SIZE}" "${OG_LOGO_TEXT_GAP}" \
  "#111827" "${OG_TITLE_POINTSIZE}" "${OG_TITLE_KERNING}"
render_social_card "${OUT}/social/og-image-dark-1200x630.png" \
  "${OG_WIDTH}" "${OG_HEIGHT}" "${SOFT_BLACK_BG}" \
  "${TMP_DIR}/logo-padded-white-1024.png" "${OG_LOGO_SIZE}" "${OG_LOGO_TEXT_GAP}" \
  "white" "${OG_TITLE_POINTSIZE}" "${OG_TITLE_KERNING}"
render_social_card "${OUT}/social/og-image-accent-1200x630.png" \
  "${OG_WIDTH}" "${OG_HEIGHT}" "${ACCENT_BG}" \
  "${TMP_DIR}/logo-padded-white-1024.png" "${OG_LOGO_SIZE}" "${OG_LOGO_TEXT_GAP}" \
  "white" "${OG_TITLE_POINTSIZE}" "${OG_TITLE_KERNING}"
render_social_card "${OUT}/social/og-image-accent-hover-1200x630.png" \
  "${OG_WIDTH}" "${OG_HEIGHT}" "${ACCENT_HOVER_BG}" \
  "${TMP_DIR}/logo-padded-white-1024.png" "${OG_LOGO_SIZE}" "${OG_LOGO_TEXT_GAP}" \
  "white" "${OG_TITLE_POINTSIZE}" "${OG_TITLE_KERNING}"
render_social_card "${OUT}/social/twitter-card-1200x600.png" \
  "${TWITTER_WIDTH}" "${TWITTER_HEIGHT}" "white" \
  "${TMP_DIR}/logo-padded-black-1024.png" "${TWITTER_LOGO_SIZE}" "${TWITTER_LOGO_TEXT_GAP}" \
  "#111827" "${TWITTER_TITLE_POINTSIZE}" "${TWITTER_TITLE_KERNING}"
render_social_card "${OUT}/social/twitter-card-dark-1200x600.png" \
  "${TWITTER_WIDTH}" "${TWITTER_HEIGHT}" "${SOFT_BLACK_BG}" \
  "${TMP_DIR}/logo-padded-white-1024.png" "${TWITTER_LOGO_SIZE}" "${TWITTER_LOGO_TEXT_GAP}" \
  "white" "${TWITTER_TITLE_POINTSIZE}" "${TWITTER_TITLE_KERNING}"
render_social_card "${OUT}/social/twitter-card-accent-1200x600.png" \
  "${TWITTER_WIDTH}" "${TWITTER_HEIGHT}" "${ACCENT_BG}" \
  "${TMP_DIR}/logo-padded-white-1024.png" "${TWITTER_LOGO_SIZE}" "${TWITTER_LOGO_TEXT_GAP}" \
  "white" "${TWITTER_TITLE_POINTSIZE}" "${TWITTER_TITLE_KERNING}"
render_social_card "${OUT}/social/twitter-card-accent-hover-1200x600.png" \
  "${TWITTER_WIDTH}" "${TWITTER_HEIGHT}" "${ACCENT_HOVER_BG}" \
  "${TMP_DIR}/logo-padded-white-1024.png" "${TWITTER_LOGO_SIZE}" "${TWITTER_LOGO_TEXT_GAP}" \
  "white" "${TWITTER_TITLE_POINTSIZE}" "${TWITTER_TITLE_KERNING}"

echo "brand-assets generated in: ${OUT}"
