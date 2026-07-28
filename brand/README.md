# Icon sources

Both icons are the boot sequence frozen at its best moment: the seam of light
opens in the black and the mark rises out of it. Same motif as the intro, so the
thing you tap looks like the thing that appears.

`icon-app.html` — the macOS icon. Draws its own rounded tile inside a 1024px
canvas with transparent margins, because macOS expects the artwork to sit in a
squircle and adds its own shadow.

`icon-remote.html` — the home-screen icon. Full-bleed square with the mark inset,
because iOS applies its own mask and a pre-rounded tile would round twice.

## Rebuilding

```bash
BRAVE="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
"$BRAVE" --headless --disable-gpu --window-size=1024,1024 --hide-scrollbars \
  --default-background-color=00000000 \
  --screenshot=app.png "file://$PWD/brand/icon-app.html"
"$BRAVE" --headless --disable-gpu --window-size=1024,1024 --hide-scrollbars \
  --screenshot=remote.png "file://$PWD/brand/icon-remote.html"

mkdir GzowoTV.iconset
for s in 16 32 128 256 512; do
  sips -Z $s        app.png --out GzowoTV.iconset/icon_${s}x${s}.png
  sips -Z $((s*2))  app.png --out GzowoTV.iconset/icon_${s}x${s}@2x.png
done
iconutil -c icns GzowoTV.iconset -o GzowoTV.app/Contents/Resources/GzowoTV.icns
sips -Z 512 remote.png --out remote/icon.png
```

Check the result at 64px before shipping it. The first version had a 7px seam
that vanished entirely once scaled down, leaving a plain letter on black — it is
13px now so it survives the Dock.
