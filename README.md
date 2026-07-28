# Gzowo TV

An Apple TV-style catalogue and launcher for the family television in Gzowo. A
MacBook drives the TV over HDMI, an iPhone is the remote, and the five services
the family pays for are reached through their own websites.

## What this is — and what it cannot be

Netflix, HBO Max, Disney+, Prime Video and Apple TV+ encrypt their video with DRM
(Widevine, PlayReady, FairPlay). Decryption keys go only to a certified app or a
licensed browser, none of them offer a playback API, and none can be embedded.
Even Google TV and Apple TV do not play Netflix themselves — they launch its app.

So Gzowo TV is **a catalogue and a launcher, never a player**. The parts that are
genuinely ours are the ones worth building: browsing, search, artwork, focus,
motion, and a remote that keeps working after a service takes over the screen.

YouTube is the one exception — it has an official embed API — and anything in
Gzowo Originals is ours end to end.

## How it fits together

```
iPhone (PWA remote) ──ws──▶ Node server ──CDP──▶ Brave in kiosk on the TV
                                 │
                                 └── TMDB (catalogue, artwork, availability in PL)
```

The server launches Brave with `--remote-debugging-port`, the standard Chromium
automation mode. That is what lets the phone keep working once Netflix owns the
screen: keystrokes are dispatched straight into the page over the DevTools
protocol, so no macOS Accessibility permission and no synthetic mouse are needed.

Tab 0 is the Gzowo TV interface. Every provider opens as its own tab and is closed
again on the way back.

## Running it

```bash
npm install
npm start          # server only, catalogue at http://localhost:7420/tv/
npm run tv         # server + Brave in kiosk on the television
npm run login      # one-off: sign in to the providers (see below)
```

### Signing in — once

The kiosk runs Brave against its own profile in `data/brave-profile`, so your
everyday browser is untouched and never has to be closed. That profile starts
empty, which means none of your existing sessions are there.

`npm run login` opens one tab per service, windowed and with normal browser
chrome. Sign in to each, close the window, and you are done — those sessions
live in the profile and survive restarts.

Existing logins cannot be carried over from your normal Brave: that would mean
copying session cookies around, which is not something this project does.

Or use **GzowoTV.app**, which can live in the Dock. It is a toggle: the first click
brings the server and the kiosk up, the second puts them away. Either way the
launcher detaches and exits immediately, so macOS never sees a bundled process
sitting there refusing to finish — that is what produced the force-quit prompt on
first launch, and the reason it appeared to work on the second attempt was only
that the first one had already left a server behind.

A notification confirms which way it went. Server output goes to `~/Library/Application Support/GzowoTV/gzowo.log` — runtime state lives there rather than beside the project, because a bundled app cannot reliably rewrite a file another process created inside `~/Downloads`.

The remote address is printed on start and shown on the pairing screen. Open it
on the phone, add it to the home screen once, and it behaves like a native app.

## Configuration

Copy `.env.example` to `.env`:

| Key | Purpose |
| --- | --- |
| `TMDB_API_KEY` | Catalogue, artwork, availability. Free. |
| `YOUTUBE_API_KEY` | Only needed once YouTube rows land. 10k units/day, and a single search costs 100 — results are cached to disk for that reason. |
| `PORT` | Defaults to 7420. |
| `DISPLAY_WIDTH` / `DISPLAY_HEIGHT` / `MAX_REFRESH` | Mode forced on the TV at start. Defaults to 1920×1080 at the highest rate the link allows. |

Trailers do **not** need the YouTube key — TMDB hands us the video ids directly.

## The television

The panel is 4K but the link is HDMI 1.4, so 4K caps at 30 Hz while 1920×1080
reaches 120 Hz. 1080p120 wins: twice the frame rate, and 24 fps films divide
evenly into 120 for judder-free playback where 60 Hz cannot.

Two macOS traps this works around on every start:

- The `1920 × 1080 (Default)` entry in System Settings is a HiDPI mode — macOS
  keeps sending 4K and the refresh rate stays at 30 Hz. The true mode is hidden
  from the UI and has to be set through `CGConfigureDisplayWithDisplayMode`.
- Mirroring silently re-enables itself every time HDMI is replugged.

`tools/display.swift` handles both. Inspect or apply it directly:

```bash
npm run display              # what the TV currently reports
node server/display.js apply # force the mode and break mirroring
```

## Known limits

- **720p at the providers.** Chromium ships Widevine L3. Safari would give 1080p
  but only at the cost of visibly switching applications.
- **No deep links to individual titles.** TMDB knows a film is on Netflix but not
  its Netflix id, so each hand-off opens that service's search with the title
  filled in — one click short of the film.
- **No playback progress.** What happens after the hand-off is invisible to us, so
  history records what was opened, never how far it got.
- **Purchased Apple titles** are FairPlay-locked to the macOS TV app. They get
  their own tile, and the remote there is limited to play, pause and scrubbing.
- **Subtitle and audio-track switching** is per-provider and breaks whenever one
  of them redesigns its player.
- **The Dock shows Brave, not Gzowo TV.** The process is Brave, and the Dock name and
  icon come from the bundle that owns it. Cloning Brave under our own name was
  tried and measured: an APFS clone costs no disk and takes under a second, but
  editing `Info.plist` invalidates Apple's signature and the clone refuses to
  launch — `invalid Info.plist (plist or signature have been modified)`. Ad-hoc
  re-signing gets it running again at the cost of the entitlements Widevine needs,
  which trades the icon for playback. Not worth it, and settled: in kiosk on the
  television the Dock and menu bar are not on screen at all.

## Layout

```
server/    HTTP + WebSocket, TMDB proxy, disk cache, profiles, Brave control
tv/        the television interface
remote/    the phone PWA
tools/     display.swift — reads and forces the TV's mode
```
