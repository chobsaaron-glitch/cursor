#!/usr/bin/env bash
# Packs FrameWorkshop sources into payload.zip and compiles FrameWorkshop-Setup.exe.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STAGE="$ROOT/dist/windows"
PAYLOAD="$STAGE/payload"

rm -rf "$STAGE"
mkdir -p "$PAYLOAD" "$ROOT/dist"

rsync -a \
  --exclude node_modules \
  --exclude .next \
  --exclude dist \
  --exclude coverage \
  --exclude storage \
  --exclude .git \
  --exclude src/generated \
  --exclude .env \
  --exclude .fw-installed \
  --exclude .fw-server.pid \
  --exclude '*.tsbuildinfo' \
  "$ROOT/" "$PAYLOAD/"

# Zip keeps Next.js route groups such as src/app/(app), which NSIS File /r drops.
( cd "$PAYLOAD" && zip -qr "$STAGE/payload.zip" . )
cp "$ROOT/scripts/windows/FrameWorkshop.nsi" "$STAGE/FrameWorkshop.nsi"

if ! command -v makensis >/dev/null 2>&1; then
  echo "makensis не найден. Установите NSIS: apt install nsis"
  echo "Подготовленный каталог: $STAGE"
  exit 1
fi

( cd "$STAGE" && makensis -V2 FrameWorkshop.nsi )
mv "$STAGE/FrameWorkshop-Setup.exe" "$ROOT/dist/FrameWorkshop-Setup.exe"
ls -lh "$ROOT/dist/FrameWorkshop-Setup.exe"
python3 - <<PY
import zipfile
z = zipfile.ZipFile("$STAGE/payload.zip")
names = z.namelist()
assert any("(app)" in n for n in names), "zip lost src/app/(app)"
print(f"В архиве файлов: {len(names)}")
PY
echo "Готово: $ROOT/dist/FrameWorkshop-Setup.exe"
