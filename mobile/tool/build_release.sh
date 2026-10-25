#!/usr/bin/env bash
# Builds the release artifacts locally: one universal APK (armeabi-v7a, arm64-v8a, x86_64)
# and one Android App Bundle, both obfuscated, with the Dart symbols kept outside them.
#
#   tool/build_release.sh            # signed with android/key.properties or STRAKER_* env
#   STRAKER_ALLOW_DEBUG_SIGNING=true tool/build_release.sh   # throwaway test build only
#
# Output: dist/Stracker-release.apk, dist/Stracker-release.aab, *.sha256, and
# build/symbols/ (needed by `flutter symbolize` to read an obfuscated stack trace).
# x86 (32-bit) is not produced: Flutter publishes no android-x86 release engine.
set -euo pipefail
cd "$(dirname "$0")/.."

common=(--release --obfuscate --split-debug-info=build/symbols)

flutter build apk "${common[@]}" --target-platform android-arm,android-arm64,android-x64
flutter build appbundle "${common[@]}" --target-platform android-arm,android-arm64,android-x64

mkdir -p dist
cp build/app/outputs/flutter-apk/app-release.apk dist/Stracker-release.apk
cp build/app/outputs/bundle/release/app-release.aab dist/Stracker-release.aab
(cd dist && sha256sum Stracker-release.apk > Stracker-release.apk.sha256 \
  && sha256sum Stracker-release.aab > Stracker-release.aab.sha256)
ls -l dist/Stracker-release.apk dist/Stracker-release.aab
