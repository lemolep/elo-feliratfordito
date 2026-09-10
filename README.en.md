# Live Subtitle Translator — Chrome extension

*[Magyar leírás](README.md)*

Reads live subtitles from any web page, translates them instantly with DeepL into the
**language of your choice**, and shows them in a draggable, resizable floating window.
DeepL detects the source language on its own, so the same setup works for English, German,
Spanish and the rest. The full transcript (original + translation) is saved continuously and
can be exported to a `.txt` file.

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

- **Quick way:** open the site, click the extension icon → *Allow on this site*
- **Or:** Settings → *Allowed sites* → type the domain (e.g. `example.com`) → **Add**

Subdomains are included automatically.

> **If the player sits in an iframe from another domain** (e.g. `player.somecdn.com`), that
> domain has to be allowed as well, otherwise the extension cannot see inside it. You don't
> have to hunt for it: **Diagnostics** lists the embedded frames on the page, each with an
> *Allow* button. This is a browser security boundary — content
> of a cross-origin frame cannot be read without permission, by any means.

## 5. Usage

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
| **🔊 / 🔇** | turn speech on and off |
| **Save** | download the transcript as `.txt` |
| **⚙** | settings and history |
| **✕** | hide the window |

Drag it by the header, resize it from the bottom-right corner. Position, size, font size,
opacity and view mode are remembered **per site**.

### Keyboard shortcuts

- `Alt` + `Shift` + `T` — show / hide the window
- `Alt` + `Shift` + `S` — start / stop capturing

Both can be rebound at `chrome://extensions/shortcuts`.

## 6. Saving and history

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

### Moving your settings to another machine

Settings → *Backup and restore settings*. **Save to file** writes your keys, allowed sites,
selected subtitle elements and speech settings into a single JSON file; **Restore from file**
reads it back on the other machine. Recorded transcripts are not included — download those
separately under recordings.

The **Include the API keys** checkbox can be turned off. If you leave it on, the file contains
your DeepL and Google keys in readable form — treat it like a password.

After restoring, the sites appear in the list, but the browser only grants permission on a
click: press **Allow** next to each of them.

## 7. How it finds the subtitles

Two sources, in this order:

1. **A picked DOM element** — if you selected one for this site, it is watched with a
   `MutationObserver`. If the player re-renders it, the element is looked up again twice a
   second. The picker does not take exactly what you clicked: starting from the clicked text
   node it **walks up** while the parent still holds essentially the same text. That lands on
   the stable subtitle container (on YouTube, `#ytp-caption-window-container`) instead of the
   span the player throws away after every sentence.
2. **The video's own text track** (`TextTrack` / `cuechange`) — used when no element is picked.
   This is the more reliable source when the player uses standard HTML5 subtitles.

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

## 8. Troubleshooting

| Symptom | What to do |
|---|---|
| The window does not appear | Did you allow the domain? Reload the page afterwards (F5). |
| `Extension context invalidated` in the console | Happens when you reload the extension at `chrome://extensions` while the page is open: the old instance is orphaned. The window dims and tells you to reload — **F5** fixes it. Normal during development. |
| "No subtitle track found" | Turn on CC in the player, then use the ◎ picker and click the subtitle. |
| The picked element has no text | First check that subtitles are on. If they are visible but **Diagnostics** still finds no text, the subtitle is **burned into the video image** and cannot be read from the DOM. This extension cannot handle that — it would need OCR or speech recognition. |
| Diagnostics reports `videó: 0` while a video is playing | The player is in a cross-origin iframe. Diagnostics lists the embedded frames (largest first) — press *Allow* next to it, then F5. In this case the picker does not work over the video either: the click stays inside the iframe. |
| "(not translated)" next to the lines | Check the message in the window's status bar: bad key (403) or exhausted quota (456). The original text is still recorded. |
| Subtitles are lost mid-session | The player replaced the element. Pick again, or delete the rule: Settings → *Selected subtitle elements*, or the *Delete rule* button on the Diagnostics card. |
| Wrong element picked (it translates a menu label) | Diagnostics → *Delete rule*. If you don't delete it, after 6 seconds the extension falls back to the video's own text track when one exists — but the bad rule stays until removed. |

For debugging: `chrome://extensions` → the **service worker** link under the extension (background
log), and F12 → Console on the page itself.

## 9. Project layout

```
manifest.json
_locales/hu, _locales/en       interface texts (the browser picks by its own language)
background/service-worker.js   DeepL calls, recordings, message relay, script registration
content/capture.js             subtitle capture and picker, runs in every frame
content/overlay.js             the floating window (top frame only)
content/overlay-css.js         window styling (injected into Shadow DOM, CSP-safe)
lib/i18n.js                    translation layer (chrome.i18n + DOM labelling)
lib/tts.js                     Google Cloud TTS client (voices, synthesis)
lib/store.js                   chrome.storage layer
lib/deepl.js                   DeepL client (endpoint, languages, error handling)
lib/segmenter.js               raw subtitles -> finished sentences, dedup, rolling captions
lib/selector.js                stable CSS selector for the picked element
popup/                         quick controls and diagnostics
options/                       settings and history
```

## 10. Privacy

- **There is no server behind this extension.** No telemetry, nothing is sent to the author.
- **Outbound connections exist only for translation and speech:** finished subtitle sentences
  go to the DeepL API using *your own* key, and if you enable speech, the translated sentences
  go to Google Cloud TTS using *your own* Google key. That is governed by DeepL's privacy policy —
  <https://www.deepl.com/privacy>. If that is not acceptable for a given piece of content,
  do not use the extension there.
- **Everything else stays local:** the DeepL key, allowed domains, picked subtitle elements,
  window settings and recorded transcripts live in the browser's own storage
  (`chrome.storage.local`) on that machine. Removing the extension removes them too.
- **It only runs on sites you allow.** No host access is requested at install time; you grant
  each domain explicitly and can revoke it at any time (Settings → *Allowed sites*).
- The DeepL key is stored unencrypted. Do not use it on a shared machine.

## 11. License

MIT — see [LICENSE](LICENSE). Use it, modify it, redistribute it freely.

Not affiliated with DeepL SE or with any video provider.

## 12. Deliberately not supported (yet)

- `.srt` export with timecodes
- OCR (burned-in subtitles) and speech recognition (STT)
- Translation engines other than DeepL
- Interface languages beyond Hungarian and English
