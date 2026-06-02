#!/usr/bin/env bash
# Render build/*.html -> pdf/*.pdf with headless Chrome, then build the
# scanned/image-only variant (#12) which has no text layer.
set -euo pipefail
cd "$(dirname "$0")"

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
[ -x "$CHROME" ] || { echo "Chrome not found at: $CHROME (set \$CHROME)"; exit 1; }

mkdir -p pdf
for f in build/*.html; do
  name=$(basename "$f" .html)
  [ "$name" = "12_scanned" ] && continue   # built separately below
  "$CHROME" --headless --disable-gpu --no-pdf-header-footer \
    --print-to-pdf="pdf/${name}.pdf" "file://$(pwd)/$f" 2>/dev/null
  echo "rendered pdf/${name}.pdf"
done

# #12: rasterize the mixed-VAT invoice and re-wrap as an image-only, skewed scan.
pdftoppm -png -r 150 pdf/01_mixed_vat_25_12.pdf build/scan_page >/dev/null 2>&1
IMG=$(ls build/scan_page*.png | head -1)
cat > build/12_scanned.html <<EOF
<!doctype html><html><head><meta charset="utf-8">
<style>@page{size:A4;margin:0} html,body{margin:0;padding:0;height:100%;overflow:hidden}
img{height:100vh;width:auto;display:block;margin:0 auto;filter:grayscale(100%) contrast(110%) brightness(98%);transform:rotate(-0.4deg)}</style>
</head><body><img src="$(basename "$IMG")"></body></html>
EOF
"$CHROME" --headless --disable-gpu --no-pdf-header-footer \
  --print-to-pdf="pdf/12_scanned_image_only.pdf" "file://$(pwd)/build/12_scanned.html" 2>/dev/null
echo "rendered pdf/12_scanned_image_only.pdf (image-only, no text layer)"
