# Live Subtitle Translator — Chrome extension

*[Magyar leírás](README.md)*

Reads live subtitles from any web page, translates them instantly with DeepL into the
**language of your choice**, and shows them in a draggable, resizable floating window.
DeepL detects the source language on its own, so the same setup works for English, German,
Spanish and the rest. The full transcript (original + translation) is saved continuously and
can be saved as a `.txt` transcript or an `.srt` subtitle file.

If a video has **no subtitles at all**, **audio mode** works from its sound instead: Deepgram's
speech recognition turns it into English text, and everything else works the same.

Manifest V3, plain JavaScript — **no build step, no npm**.

> The interface follows your browser language: **English** and **Hungarian** are included.

---

## 1. Install

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and select this folder
4. Pin the extension from the puzzle icon in the toolbar

Keep the folder somewhere permanent — Chrome reads the extension from that location rather
than copying it. If you delete or rename the folder, the extension stops working.

## 2. DeepL API key

1. Get a key at <https://www.deepl.com/pro-api> (the Free tier gives 500,000 characters per
   month; signup requires a card but it is not charged)
2. Extension icon → **Settings and history** → *DeepL API key*
3. Paste the key, then press **Test**

Free keys end in `:fx` — the extension uses that to pick the right DeepL endpoint, so you can
switch to a Pro key later without touching any code.

The key is stored **unencrypted** in the browser's own storage on this machine.

### Target language

Settings → *Translation and appearance* → **Target language**. The dropdown lists every
DeepL target language, named in your interface language.

You do not need to specify a source language — DeepL detects it automatically.

The list is bundled with the extension, but as soon as you enter a key it is refreshed from
the DeepL API, so newly supported languages show up too. The *Refresh list* button refreshes it manually. The floating window header always shows the current target (e.g. `→ EN-GB`).

### Terminology glossary

If DeepL translates a term inconsistently, set the wording under Settings →
**Terminology glossary**. One pair per line:

```
neuroception = Neurozeption
autonomic nervous system = autonomes Nervensystem
# a line starting with # is a comment
```

Besides `=`, a tab, `→` and `;` also work as separators. **Check and upload** reports how
many pairs are valid, lists any invalid lines, and uploads the glossary to DeepL.

This uses DeepL's own glossary feature rather than a find-and-replace afterwards: it applies
**during** translation, so it also affects inflected forms. Two things worth knowing:

- DeepL requires the source language to be known, while we let it auto-detect. So the glossary
  takes effect **after the first translated sentence** — and stays active from then on.
- When you switch target language, a new glossary is uploaded from the same pairs. The pairs
  naturally belong to one target language, so rewrite them if you switch.

If the upload fails for any reason, translation **continues without the glossary** — nothing
breaks — and the Check button reports the error.

### Hearing fixes

The glossary steers the **translation**, but if recognition (or an auto-generated subtitle)
**wrote the word down wrong** in the first place, DeepL cannot fix it: it translates what it
gets. That is what Settings → **Hearing fixes** is for — it replaces the word **before**
translation:

```
Unite → Unyte
MyUnite → MyUnyte
safe and sound protocol → Safe and Sound Protocol
```

`→`, `->`, `=` and a tab all work as separators. While you type it shows how many rules are
valid and which lines are not.

- **Whole words only**, case-insensitive: the `Unite` rule leaves *United* alone. So a
  compound word (`MyUnite`) needs its own line.
- **Applies in both modes**: YouTube's auto-generated subtitles mishear the same way.
- In audio mode the **correct forms** are also sent to Deepgram as key terms, so recognition
  itself gets better at them.

## 3. Speech (Google Cloud TTS) — optional

The translated lines can also be read aloud as they arrive.

1. In the [Google Cloud console](https://console.cloud.google.com/), enable the
   **Cloud Text-to-Speech API** and create an **API key**
2. Settings → *Speech* → paste the key → **Test** (plays a sample)
3. Tick **Enable speech** and pick a **voice**

The voice list follows the target language: when you change what the subtitles are
translated into, the extension fetches the matching voices and puts the **Chirp3 HD**
ones first — those sound the most natural. **Speaking rate** is adjustable between
0.25× and 2×; 1.1–1.3 often helps with live subtitles.

Toggle it on the fly with the **🔊 / 🔇** button in the translator window.

### Turning down the original audio

While the translated voice speaks, the video's own audio is turned down and restored
afterwards, so the two do not talk over each other. The level is configurable (*Original
audio while speaking*), **20%** by default; 0% means fully silent.

It fades briefly so there is no click, and it **does not come back between consecutive
sentences** — only when speech actually stops. This works for players in an embedded frame
too, as long as you allowed that frame's domain.

**How it works:** clips are played strictly **one after another**, in subtitle order — they
never overlap.

The extension **never waits for text**: as soon as there is something to say, it says it. But
while a clip is playing, the fragments that arrive meanwhile are **merged into a single
clip**. That means fewer, longer clips — fewer pauses between sentences, and more natural
intonation, because the TTS receives continuous text instead of separate fragments. It adds
no delay: only what would have been queued anyway gets merged.

Under heavy backlog the oldest fragments are dropped so it catches up with the present; the
transcript still keeps every line.

> Google Cloud TTS is a **separate paid service** with a monthly free tier, entirely
> independent of the DeepL key. In the Google console, restrict the key to the
> Text-to-Speech API.

## 4. Allow a site

The extension only runs on sites you explicitly allow. It requests **no host access at
install time**.

- **Simplest:** Settings → *Automatic mode* → **Allow on every site**. That is a single
  permission prompt, and afterwards it never asks again — not per site, not for embedded
  frames. (The same button is in the popup.)
- **Quick way, this site only:** open the site, click the extension icon → *Allow on this site*
- **Or:** Settings → *Allowed sites* → type the domain (e.g. `example.com`) → **Add**

> The extension **cannot accept the browser's permission prompt on its own** — Chrome
> forbids that, precisely so an extension cannot grant itself access behind your back.
> What is possible is to ask once for everything, after which there are no more prompts.

You can revoke the *every site* grant at any time with the **Revoke** button in the same place.

Subdomains are included automatically.

> **If the player sits in an iframe from another domain** (e.g. `player.somecdn.com`), that
> domain has to be allowed as well, otherwise the extension cannot see inside it. You don't
> have to hunt for it: **Diagnostics** lists the embedded frames on the page, each with an
> *Allow* button. This is a browser security boundary — content
> of a cross-origin frame cannot be read without permission, by any means.

### Automatic mode

*Settings → Automatic mode* has two switches, both on by default:

| Switch | What it does |
|---|---|
| **Turn the subtitle track on automatically** | If the video has a subtitle track that is switched off, the extension enables it in `hidden` mode. It receives the text, but **no subtitle appears on the video**, so what you see does not change. The original state is restored when you stop. |
| **Start automatically when subtitles are found** | When subtitles show up on a video that is already playing, the window opens and translation starts by itself. It fires once per page load: if you stop it, it will not restart behind your back. |

Automatic start needs the DeepL key — without one it will not start by itself.

> **Mind the quota:** automatic start spends your DeepL character quota on every subtitled
> video, even while you are doing something else. If the quota runs low, switch it off and
> start manually with **Start**.

## 5. Audio mode — for videos without subtitles

Many videos have no subtitles: no CC button, no text track to read from. In that case the
extension can work from the **tab's audio**. [Deepgram](https://deepgram.com)'s speech
recognition turns it into English text live, DeepL translates that, and from there everything
works as with subtitles: bilingual lines, glossary, saving, speech.

This also works when the player sits in a cross-origin frame (e.g. Vimeo): it takes the tab's
**entire audio**, so no permission for the frame is needed.

### Deepgram key

1. Sign up: <https://console.deepgram.com/signup> (Google or GitHub accounts work too).
   New accounts get **$200 of free credit**, **no card required** (as of October 2026).
2. In the console: **API Keys** → **Create a New API Key**. Keep the role at **Default**: it
   only allows usage, not account management — if the key ever leaked, that limits the damage.
   For expiration pick the longest option or "never".
3. Extension → Settings → **Speech recognition (Deepgram)** → paste the key → **Test**.
   The test sends one second of silence; it costs a fraction of a cent.

The key goes into the extension's own secret store, just like the DeepL and Google keys.

### Starting it

- Click the extension **icon** → **🎤 Start audio mode**, or
- **`Alt` + `Shift` + `A`**

🎤 also starts recording, and **Stop** also stops audio mode.

> **Why doesn't the floating window's 🎤 work the first time?** Chrome only hands over a tab's
> audio after you **invoke the extension on that tab**: click its icon or press its shortcut.
> This is Chrome's security rule; even the "allow on every site" permission does not replace it.
> After one invocation, the floating window's 🎤 works until the tab is closed. If you press it
> first anyway, it tells you what to do.

While audio mode runs, subtitle capture is paused — otherwise on a page that has subtitles too,
every sentence would arrive twice.

### What you see

- A **faint italic line** at the bottom: what Deepgram is hearing right now, still forming.
  It is neither translated nor saved — it changes several times a second and would burn
  through the DeepL quota.
- As soon as a **sentence** is complete, the regular bilingual line appears in its place.

Deepgram closes a segment wherever the speaker takes a breath — often mid-sentence. So the
extension **collects up to the end of the sentence** and only translates complete sentences;
half a sentence translates badly. If no sentence end arrives for 2.5 seconds, the text moves on
anyway. With background music (no silence for Deepgram to detect the end of a segment) it
requests finalisation itself after 7 seconds.

### Accuracy: the glossary and hearing fixes help here too

The source side of your glossary and the correct forms from your **hearing fixes** are sent to
Deepgram as **key terms**, so brand and technical names are recognised correctly, not only
translated correctly. If it still mishears a word (Deepgram heard "Unyte" as "Unite"), the
**hearing fixes** list replaces it before translation (see section 2). Glossary example:

```
Unyte = Unyte
MyUnyte = MyUnyte
Safe and Sound Protocol = Safe and Sound Protocol
SSP = SSP
```

The saved transcript's **timestamps follow the video's own time**: from the player if it is on
the page, from Vimeo's own messages if it is in a Vimeo frame. Since a sentence arrives at its
end, the extension counts back to the **start of the sentence** — seek to the timestamp and you
hear it from the beginning.

### Speech and ducking in audio mode

In audio mode, speech does **not play in the tab** but in the extension's own invisible page.
If it played in the tab, the capture would hear our own translated voice and try to recognise
it as English. Ducking happens there too, and only lowers **the audio going to the speakers**:
recognition still gets the original at full volume.

### Cost

> Deepgram is **billed per minute**: live English recognition is roughly **$0.0077/minute**
> (October 2026 price; check the current one at <https://deepgram.com/pricing>). A one-hour
> video is about **half a dollar**; the $200 starting credit is **hundreds of hours**.
>
> That is why audio mode **never starts on its own**, only on a click. **While 🎤 is green, the
> meter is running — even if the video is paused.** If you have not added a card, the service
> simply stops when the credit runs out; you will not be billed.

## 6. Usage

1. Open the page, start the video and **turn on subtitles (CC)** in the player
2. Press **Start** in the floating window
3. If no subtitles arrive, click the **◎ picker** and then click the subtitle text itself.
   The extension remembers that element for the domain and reads from it afterwards.
   If the translator window covers the subtitle, drag it out of the way first: during picking
   the window becomes click-through, but a click landing on it is not accepted as a selection.
   Clicking a link or a button saves nothing either — that is certainly a mis-click.
4. When done press **Stop** → choose a filename → the `.txt` is downloaded

### Not sure whether the subtitles are readable?

Click the extension icon → **Diagnostics — what does it see?** For each frame it reports
how many videos and subtitle tracks it finds, shows the text it is currently reading, and if
it spots a likely subtitle element, one button sets it as the source — no picking needed.

This is the fastest way to tell whether the subtitle is real text in the DOM or burned into
the video image.

### Window controls

| Button | What it does |
|---|---|
| **Start / Stop** | start and stop capturing |
| **2 languages / 1 language** | original + translation, or translation only |
| **A− / A+** | font size between 12 and 48 px |
| slider | background opacity (30–100%) |
| **◎** | picker — select the subtitle element on the page |
| **🎤** | audio mode on and off (see section 5) |
| **🔊 / 🔇** | turn speech on and off |
| **Save** | download the transcript (`.txt`) or a subtitle file (`.srt`) |
| **⚙** | settings and history |
| **✕** | hide the window |

Drag it by the header, resize it from the bottom-right corner. Position, size, font size,
opacity and view mode are remembered **per site**.

### Keyboard shortcuts

- `Alt` + `Shift` + `T` — show / hide the window
- `Alt` + `Shift` + `S` — start / stop capturing
- `Alt` + `Shift` + `A` — audio mode on / off

Both can be rebound at `chrome://extensions/shortcuts`.

## 7. Saving and history

- **Live backup:** every line reaches storage within 3 seconds, so nothing is lost if the tab
  crashes or you close it by accident
- **History:** Settings → *Previous recordings* — date, site, duration, line count; any of
  them can be downloaded or deleted later
- The `.txt` always contains **both languages**, regardless of the current view:

```
# Live subtitle translation (EN-GB) — Video title
# Source: https://example.com/video/123
# Recorded: 2026-09-04 19:12 – 20:03
# Lines: 412

[00:01:23]
ORIGINAL: Hallo zusammen, willkommen zurück.
EN-GB: Hello everyone, welcome back.
```

### Subtitle file (.srt)

The save dialog also lets you choose the format:

| Format | Good for |
|---|---|
| **Transcript (.txt)** | reading, note-taking — both languages, with timestamps |
| **Subtitles — translation (.srt)** | the video: load it into a player (VLC, mpv), a video editor, or upload it alongside the video |
| **Subtitles — bilingual (.srt)** | the translation on top, the original in italics below — good for language learning |
| **Subtitles — original (.srt)** | the original-language text as subtitles |

The extension remembers your last choice. In the history, every recording also has a
**Subtitles (.srt)** button (with the translation).

```
1
00:00:19,000 --> 00:00:21,933
Digital delivery of SSP
consists of two parts.
```

Timing comes from **the video's own time** (in audio mode, Vimeo-framed players included). A
subtitle stays until the next one starts, but at least 1.2 and at most 7 seconds, depending on
its length. A line is at most 42 characters, a cue at most two lines; a longer sentence is split
into consecutive cues. If you rewound and re-watched a part, cues are sorted by video time.

> In subtitle mode a line's time is when the sentence was closed (the subtitle had already been
> on screen for a while), so cues may start slightly later than the original subtitle. In audio
> mode we count back to the start of the sentence, so it is more accurate there.

### Moving your settings to another machine

Settings → *Backup and restore settings*. **Save to file** writes your keys, allowed sites,
selected subtitle elements and speech settings into a single JSON file; **Restore from file**
reads it back on the other machine. Recorded transcripts are not included — download those
separately under recordings.

The **Include the API keys** checkbox is off by default, so no key goes into the file.
If you tick it, the file contains your DeepL and Google keys in readable form — treat it like a password.

After restoring, the sites appear in the list, but the browser only grants permission on a
click: press **Allow** next to each of them.

## 8. How it finds the subtitles

*(This is subtitle mode. For videos without subtitles see section 5: audio mode.)*

It **hunts on its own**, with no clicking, in this order:

1. **A picked DOM element** — if you selected one for this site it wins; it is watched with a
   `MutationObserver` and looked up again twice a second if the player re-renders it. The
   picker does not take exactly what you clicked: starting from the clicked text node it
   **walks up** while the parent still holds essentially the same text. That lands on the
   stable subtitle container instead of the span the player throws away after every sentence.
   If your own rule yields nothing for 8 seconds, the extension looks for another source.
2. **The video's own text track** (`TextTrack` / `cuechange`). If the track is switched off,
   it is enabled in `hidden` mode — the text arrives without any subtitle appearing on the
   video. **One** track per video is bound, otherwise two languages would interleave.
3. **Known player caption containers** — YouTube, Video.js, JW Player, Shaka, Plyr, Bitmovin,
   Vimeo. No picking needed there; the extension knows where to look.
4. **A guess** — based on `caption` / `subtitle` / `cue` class names and `aria-live`.

Until text actually arrives it retries the whole ladder twice a second: players often build
the subtitle element long after page load.

Raw subtitle updates are not sent to DeepL one by one. The extension waits for a sentence
boundary (`.` `!` `?`) or for the text to stay unchanged for a configurable delay (1200 ms by
default). That cuts API calls to roughly a third and produces noticeably better translations.
The delay is adjustable between 300 and 3000 ms.

**Rolling subtitles** are handled too — the pattern where the top line scrolls out while a new
one arrives at the bottom, exactly how YouTube's automatic captions behave. The extension
detects the overlap between the old and new state, so text is neither duplicated nor lost.

It also **strips timecodes** out of the subtitle text. Transcript panels (YouTube's
"Transcript" view, for example) prefix every line with `0:12` — that is not part of the
subtitle and would only corrupt the translation. A clock time spoken in the dialogue
(`we meet at 3:30`, `3:30 PM`) is kept. This is unrelated to the `[00:01:23]` stamps in
the saved file, which come from the video's playback position.

## 9. Troubleshooting

| Symptom | What to do |
|---|---|
| The window does not appear | Did you allow the domain? Reload the page afterwards (F5). |
| `Extension context invalidated` in the console | Happens when you reload the extension at `chrome://extensions` while the page is open: the old instance is orphaned. The window dims and tells you to reload — **F5** fixes it. Normal during development. |
| "No subtitle track found" | Turn on CC in the player, then use the ◎ picker and click the subtitle. |
| The picked element has no text | First check that subtitles are on. If they are visible but **Diagnostics** still finds no text, the subtitle is **burned into the video image** and cannot be read from the DOM. Use **audio mode** (section 5). |
| The video has no subtitles at all | **Audio mode** (section 5). |
| 🎤: *"Chrome only hands over the tab audio…"* | Click the extension icon → **🎤 Start audio mode**, or `Alt`+`Shift`+`A`. After that the floating window's 🎤 works too. |
| *"Deepgram refused the connection"* | Almost always the key. Settings → Speech recognition → **Test**. |
| *"No Deepgram key"* | The audio plays but nothing is recognised: add the key in the settings. |
| *"Deepgram received no audio"* | Is the video playing? It may be muted or paused. |
| A brand name is misspelled (e.g. *Unite* instead of *Unyte*) | Settings → **Hearing fixes**: `Unite → Unyte` (and `MyUnite → MyUnyte`). It replaces the word before translation, and Deepgram gets the correct form as a key term. |
| Diagnostics reports `videó: 0` while a video is playing | The player is in a cross-origin iframe. Diagnostics lists the embedded frames (largest first) — press *Allow* next to it, then F5. In this case the picker does not work over the video either: the click stays inside the iframe. |
| "(not translated)" next to the lines | Check the message in the window's status bar: bad key (403) or exhausted quota (456). The original text is still recorded. |
| Subtitles are lost mid-session | The player replaced the element. Pick again, or delete the rule: Settings → *Selected subtitle elements*, or the *Delete rule* button on the Diagnostics card. |
| Wrong element picked (it translates a menu label) | Diagnostics → *Delete rule*. If you don't delete it, after 6 seconds the extension falls back to the video's own text track when one exists — but the bad rule stays until removed. |

For debugging: `chrome://extensions` → the **service worker** link under the extension (background
log), and F12 → Console on the page itself.

## 10. Project layout

```
manifest.json
_locales/hu, _locales/en       interface texts (the browser picks by its own language)
background/service-worker.js   DeepL calls, recordings, message relay, script registration
content/capture.js             subtitle capture and picker, runs in every frame
content/overlay.js             the floating window (top frame only)
content/overlay-css.js         window styling (injected into Shadow DOM, CSP-safe)
content/vimeo.js               the time of a Vimeo-framed player (audio mode timestamps)
offscreen/                     invisible page: tab audio, speech and ducking in audio mode
lib/i18n.js                    translation layer (chrome.i18n + DOM labelling)
lib/tts.js                     Google Cloud TTS client (voices, synthesis)
lib/store.js                   chrome.storage layer
lib/deepl.js                   DeepL client (endpoint, languages, error handling)
lib/segmenter.js               raw subtitles -> finished sentences, dedup, rolling captions
lib/stt.js                     speech recognition with a swappable provider (now: Deepgram)
lib/sentences.js               audio mode: recognised segments -> complete sentences
lib/selector.js                stable CSS selector for the picked element
popup/                         quick controls and diagnostics
options/                       settings and history
tests/                         tests (node tests/run-all.js) — not included in the release zip
```

## 11. Privacy

- **There is no server behind this extension.** No telemetry, nothing is sent to the author.
- **Outbound connections exist only for translation and speech:** finished subtitle sentences
  go to the DeepL API using *your own* key, and if you enable speech, the translated sentences
  go to Google Cloud TTS using *your own* Google key. Translation is governed by DeepL's privacy
  policy (<https://www.deepl.com/privacy>), speech by Google Cloud's privacy notice
  (<https://cloud.google.com/terms/cloud-privacy-notice>). If that is not acceptable for a given
  piece of content, do not use the extension there.
- **In audio mode the tab's audio goes to Deepgram**, using *your own* Deepgram key — but only
  while 🎤 is green, and only the audio of the tab you started it on. This is governed by
  Deepgram's privacy policy (<https://deepgram.com/privacy>). The extension only gets the tab
  audio on a click: Chrome does not allow it otherwise.
- **Everything else stays local:** allowed domains, picked subtitle elements, window settings
  and recorded transcripts live in the browser's own storage (`chrome.storage.local`) on that
  machine. The DeepL, Google and Deepgram keys are kept separately, in the extension's own IndexedDB
  database: only the settings page, the popup and the background worker can read it; the
  script injected into web pages cannot, it only knows whether a key exists. Removing the
  extension removes all of this too.
- **It only runs on sites you allow.** No host access is requested at install time; you grant
  each domain explicitly and can revoke it at any time (Settings → *Allowed sites*).
- The keys are stored unencrypted. Do not use it on a shared machine.

## 12. License

MIT — see [LICENSE](LICENSE). Use it, modify it, redistribute it freely.

Not affiliated with DeepL SE or with any video provider.

## 13. Deliberately not supported (yet)

- OCR (burned-in subtitles)
- Free, locally running speech recognition (e.g. Whisper) — the layer is built to be swappable
- Translation engines other than DeepL
- Interface languages beyond Hungarian and English
