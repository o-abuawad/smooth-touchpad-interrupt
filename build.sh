#!/usr/bin/env bash
set -euo pipefail

UUID="smooth-touchpad-interrupt@osama.gemini"
BUILD_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${HOME}/.local/share/gnome-shell/extensions/${UUID}"

echo "==> Compiling schemas..."
glib-compile-schemas "${BUILD_DIR}/schemas/"

echo "==> Packaging extension bundle..."
gnome-extensions pack \
  --extra-source=touchpadInterrupter.js \
  --extra-source=workspaceAnimationPatch.js \
  --extra-source=overviewPatch.js \
  --extra-source=kineticPhysics.js \
  --force

echo "==> Installing extension to ${TARGET_DIR}..."
mkdir -p "${TARGET_DIR}"
cp -r "${BUILD_DIR}"/{extension.js,touchpadInterrupter.js,overviewPatch.js,workspaceAnimationPatch.js,kineticPhysics.js,prefs.js,metadata.json,schemas,README.md,LICENSE} "${TARGET_DIR}/"
glib-compile-schemas "${TARGET_DIR}/schemas/"

echo "==> Enabling extension ${UUID}..."
gnome-extensions enable "${UUID}" || true

echo "==> Done! Extension is built, installed, and enabled."
