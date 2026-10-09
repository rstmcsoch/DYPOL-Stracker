#!/usr/bin/env bash
# Verifies a downloaded Stracker release APK. Run it on the artifact EAS produced, never on a rebuild.
#
#   scripts/verify-apk.sh path/to/stracker.apk [expected-sha256]
#
# Checks: the SHA-256 (against the expected value when one is given), the native ABIs packed in the
# APK, the signing blocks, and, when the Android build-tools are installed, the manifest values
# (package, SDK range, permissions) and the signing certificate's SHA-256.
set -euo pipefail

apk="${1:-}"
expected="${2:-}"
if [[ -z "$apk" || ! -f "$apk" ]]; then
  echo "usage: $0 <file.apk> [expected-sha256]" >&2
  exit 2
fi

fail=0
say() { printf '%s\n' "$*"; }
bad() { printf 'FAIL: %s\n' "$*"; fail=1; }

sha256=$(sha256sum "$apk" | awk '{print $1}')
say "APK:      $apk"
say "Size:     $(stat -c %s "$apk") bytes"
say "SHA-256:  $sha256"
if [[ -n "$expected" ]]; then
  if [[ "$sha256" == "$expected" ]]; then say "Checksum: matches the expected value"; else bad "checksum does not match the expected value"; fi
fi

# ABIs: every lib/<abi>/ directory in the archive.
abis=$(python3 - "$apk" <<'PY'
import sys, zipfile, re
with zipfile.ZipFile(sys.argv[1]) as z:
    found = sorted({m.group(1) for n in z.namelist() if (m := re.match(r'lib/([^/]+)/', n))})
print(' '.join(found))
PY
)
say "Native ABIs in the archive: ${abis:-none}"
for required in armeabi-v7a arm64-v8a x86 x86_64; do
  if [[ " $abis " != *" $required "* ]]; then bad "ABI $required is missing"; fi
done

# Signing: a v1 (META-INF/*.RSA) or v2/v3 APK Signature Block must be present for the device to install it.
python3 - "$apk" <<'PY' || fail=1
import sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    names = z.namelist()
    v1 = any(n.startswith('META-INF/') and n.endswith(('.RSA', '.DSA', '.EC')) for n in names)
    with open(sys.argv[1], 'rb') as handle:
        data = handle.read()
    v2 = b'APK Sig Block 42' in data
    print(f"Signature schemes: v1 (JAR) {'present' if v1 else 'absent'}, v2/v3 block {'present' if v2 else 'absent'}")
    if not (v1 or v2):
        sys.exit(1)
PY

# Manifest and certificate details need the Android build-tools (aapt2 and apksigner).
aapt=$(command -v aapt2 || command -v aapt || true)
apksigner=$(command -v apksigner || true)
if [[ -n "$aapt" ]]; then
  badging=$("$aapt" dump badging "$apk" 2>/dev/null || true)
  package=$(printf '%s\n' "$badging" | sed -n "s/^package: name='\([^']*\)'.*/\1/p")
  min=$(printf '%s\n' "$badging" | sed -n "s/^sdkVersion:'\([0-9]*\)'.*/\1/p")
  target=$(printf '%s\n' "$badging" | sed -n "s/^targetSdkVersion:'\([0-9]*\)'.*/\1/p")
  label=$(printf '%s\n' "$badging" | sed -n "s/^application-label:'\([^']*\)'.*/\1/p")
  say "Package: ${package:-unknown}  label: ${label:-unknown}  minSdk: ${min:-unknown}  targetSdk: ${target:-unknown}"
  [[ "$package" == "com.stracker.dypollabs" ]] || bad "package is not com.stracker.dypollabs"
  [[ "${min:-0}" -le 24 ]] || bad "minSdk is above 24"
  printf '%s\n' "$badging" | sed -n "s/^uses-permission: name='\([^']*\)'.*/Permission: \1/p"
else
  say "aapt2 not found: manifest checks skipped. Install Android build-tools to check package, SDK range, and permissions."
fi
if [[ -n "$apksigner" ]]; then
  "$apksigner" verify --verbose --print-certs "$apk" || bad "apksigner could not verify the signature"
else
  say "apksigner not found: certificate check skipped. Install Android build-tools to print the signing certificate SHA-256."
fi

if [[ "$fail" -ne 0 ]]; then
  say "RESULT: FAILED"
  exit 1
fi
if [[ -n "$aapt" && -n "$apksigner" ]]; then
  say "RESULT: all checks passed"
else
  say "RESULT: archive checks passed. Manifest and certificate checks were SKIPPED (build-tools not installed)."
fi
