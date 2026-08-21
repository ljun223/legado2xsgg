#!/usr/bin/env bash
# Build xbsrebuild.apk (纯 Java，无 Go 组件):
#   aapt 生成 R.java -> javac -> D8 -> aapt(manifest+res+assets) -> add classes.dex -> sign + align
set -euo pipefail
cd "$(dirname "$0")"

ANDROID_JAR="${ANDROID_JAR:-/opt/android-platform/android-9/android.jar}"
R8_JAR="${R8_JAR:-/opt/android-tools/r8.jar}"
OUT="build"
STAGE="$OUT/stage"

rm -rf "$OUT"
mkdir -p "$STAGE/classes" "$STAGE/gen"

echo "[1/6] aapt 生成 R.java ..."
aapt package -f -m -J "$STAGE/gen" -M apkui/AndroidManifest.xml \
    -S apkui/res -A assets -I "$ANDROID_JAR"

echo "[2/6] javac MainActivity + XbsTools + XXTEA + R ..."
javac -source 8 -target 8 -bootclasspath "$ANDROID_JAR" -d "$STAGE/classes" \
    $(find "$STAGE/gen" -name '*.java') \
    apkui/MainActivity.java apkui/XbsTools.java apkui/XXTEA.java

echo "[3/6] dex (D8) ..."
java -cp "$R8_JAR" com.android.tools.r8.D8 --lib "$ANDROID_JAR" --release \
    --output "$STAGE" $(find "$STAGE/classes" -name '*.class')

echo "[4/6] aapt package (manifest + res + assets/skill-xbs.md) ..."
aapt package -f -M apkui/AndroidManifest.xml -S apkui/res -A assets \
    -I "$ANDROID_JAR" -F "$OUT/unsigned.apk"

echo "[5/6] add classes.dex ..."
( cd "$STAGE" && aapt add ../unsigned.apk classes.dex )

echo "[6/6] sign + align ..."
if [ ! -f "$OUT/debug.keystore" ]; then
  keytool -genkeypair -keystore "$OUT/debug.keystore" -storepass android -keypass android \
    -alias androiddebugkey -dname "CN=Android Debug,O=Android,C=US" \
    -keyalg RSA -keysize 2048 -validity 10000 >/dev/null 2>&1
fi
jarsigner -keystore "$OUT/debug.keystore" -storepass android -keypass android \
    -signedjar "$OUT/signed.apk" "$OUT/unsigned.apk" androiddebugkey >/dev/null 2>&1
python3 tools/zipalign.py "$OUT/signed.apk" xbsrebuild.apk 4

echo "OK: $(pwd)/xbsrebuild.apk"
ls -la xbsrebuild.apk