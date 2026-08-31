#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FRAMEWORK_RES="${ANDROID_FRAMEWORK_RES:-/system/framework/framework-res.apk}"
ANDROID_JAR="${ANDROID_JAR:-/data/data/com.termux/files/usr/share/java/android-24.jar}"
KEYSTORE="${CREW_HELPER_KEYSTORE:-$SCRIPT_DIR/test.keystore}"

if [ ! -f "$KEYSTORE" ]; then
  echo "Missing signing keystore: $KEYSTORE" >&2
  echo "Set CREW_HELPER_KEYSTORE to a local keystore path; signing keys are not committed." >&2
  exit 1
fi

cd "$SCRIPT_DIR"
rm -rf bin
mkdir -p bin/classes bin/gen

echo "1. Generating R.java..."
aapt package -f -m -J bin/gen -S res -M AndroidManifest.xml -I "$FRAMEWORK_RES"

echo "2. Compiling Java classes..."
javac -d bin/classes -cp "$ANDROID_JAR:$SCRIPT_DIR/libs/*" bin/gen/com/crewpocket/helper/R.java src/com/crewpocket/helper/*.java

echo "3. Converting to DEX..."
d8 --output bin/ bin/classes/com/crewpocket/helper/*.class libs/*.jar

echo "4. Packaging APK..."
aapt package -f -M AndroidManifest.xml -S res -I "$FRAMEWORK_RES" -F bin/unsigned.apk
(cd bin && aapt add unsigned.apk classes.dex)

echo "5. Signing APK..."
apksigner sign --ks "$KEYSTORE" --ks-pass pass:123456 --key-pass pass:123456 --out bin/CrewHelper.apk bin/unsigned.apk

cp -f bin/CrewHelper.apk "$PROJECT_ROOT/public/CrewHelper.apk"
if [ -d /sdcard/Download ]; then cp -f bin/CrewHelper.apk /sdcard/Download/CrewHelper.apk 2>/dev/null || true; fi
echo "SUCCESS: Updated $PROJECT_ROOT/public/CrewHelper.apk"
