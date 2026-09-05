# Élő feliratfordító — Chrome bővítmény

*[English description](README.en.md)*

Élő feliratot olvas ki a weboldalról, azonnal lefordítja DeepL-lel a **választott nyelvre**,
és egy mozgatható, átméretezhető lebegő ablakban mutatja. A forrásnyelvet a DeepL magától
felismeri, a célnyelv a beállításokban bármelyik DeepL-nyelv lehet. A teljes átirat
(eredeti + fordítás) folyamatosan mentődik, és a végén `.txt` fájlba exportálható.

A felület nyelve a böngésző nyelvét követi: **magyar** és **angol** van beépítve.

Manifest V3, tiszta JavaScript — **nincs build lépés, nincs npm**.

---

## 1. Telepítés

1. Nyisd meg: `chrome://extensions`
2. Jobb felül kapcsold be a **Fejlesztői módot**
3. **Kicsomagolt bővítmény betöltése** → válaszd ki ezt a mappát
4. A bővítmény ikonja megjelenik az eszköztáron (tűzd ki a puzzle ikonnál)

## 2. DeepL API kulcs

1. Kulcs a <https://www.deepl.com/pro-api> oldalon szerezhető (a Free szint havi
   500 000 karakter; regisztrációhoz bankkártya kell, de nem terhel)
2. Bővítmény ikon → **Beállítások és előzmények** → *1. DeepL API kulcs*
3. Írd be a kulcsot, majd nyomd meg a **Teszt** gombot

A Free kulcs `:fx`-re végződik — a bővítmény ebből ismeri fel, melyik DeepL végpontot
kell hívnia, tehát Pro kulcsot is beírhatsz később, kódmódosítás nélkül.

A kulcs **titkosítatlanul**, a böngésző saját tárolójában marad ezen a gépen.

### Célnyelv

Beállítások → *3. Fordítás és megjelenés* → **Célnyelv**. A legördülő menüben a DeepL összes
célnyelve szerepel (magyar, német, spanyol, japán, ukrán és a többi).

A **forrásnyelvet nem kell megadni** — a DeepL magától felismeri, tehát ugyanaz a beállítás
működik angol, német vagy spanyol nyelvű felirathoz is.

A lista beépítve is megvan, de amint megadod a kulcsot, a bővítmény lekéri a DeepL-től
a **valóban aktuális** listát, így az újonnan támogatott nyelvek is megjelennek. Kézzel a
*Lista frissítése* gombbal is elkérhető. A fordítóablak fejléce mindig mutatja az aktuális
célnyelvet (pl. `→ HU`).

## 3. Oldal engedélyezése

A bővítmény csak az általad felsorolt oldalakon fut.

- **Gyorsan:** menj a kívánt oldalra, kattints a bővítmény ikonjára →
  *Engedélyezés ezen az oldalon*
- **Vagy:** Beállítások → *2. Engedélyezett oldalak* → írd be a domaint (pl.
  `pelda-stream.hu`) → **Hozzáadás**

Az aldomainek automatikusan beleértendők.

> **Ha a lejátszó egy másik domainről érkező iframe-ben van** (pl. `player.masikcdn.com`),
> azt a domaint is hozzá kell adni, különben a bővítmény nem lát bele. Nem kell keresgélned:
> a **Diagnosztika** felsorolja az oldal beágyazott kereteit, és mindegyik mellett van egy
> *Engedélyezem* gomb. Ez böngésző-biztonsági határ — idegen domainről betöltött keret
> tartalmát semmilyen trükkel nem lehet kiolvasni engedély nélkül.

## 4. Használat

1. Menj az oldalra, indítsd el a videót, és **kapcsold be a feliratot (CC)** a lejátszóban
2. Nyomd meg a lebegő ablakon a **Start** gombot
3. Ha nem jön felirat, kattints a **◎ célzó** gombra, majd magára a feliratra az oldalon —
   a bővítmény megjegyzi az elemet erre a domainre, és onnantól automatikusan onnan olvas.
   Ha a fordítóablak takarja a feliratot, előbb húzd el az útból: célzás közben az ablak
   átkattinthatóvá válik, de a rá érkező kattintást nem fogadja el kijelölésnek.
   Linkre vagy gombra kattintva sem ment el semmit — az biztosan elgépelt kijelölés lenne.
4. A végén **Stop** → megadhatod a fájlnevet → letöltődik a `.txt`

### Ha nem tudod, olvasható-e a felirat az oldalon

Kattints a bővítmény ikonjára → **Diagnosztika — mit lát az oldalon?** Keretenként megmondja,
hány videót és feliratsávot talál, mutatja, hogy éppen milyen szöveget olvas ki, és ha talál
egy valószínű feliratelemet, egy gombbal be is állíthatod feliratforrásnak — célzás nélkül.

Ez a leggyorsabb módja eldönteni, hogy a felirat szövegként a DOM-ban van-e, vagy a
videóképre van égetve.

### Az ablak vezérlői

| Gomb | Mit csinál |
|---|---|
| **Start / Stop** | rögzítés indítása és leállítása |
| **2 nyelv / 1 nyelv** | eredeti + fordítás, vagy csak a fordítás |
| **A− / A+** | betűméret 12 és 48 px között |
| csúszka | a háttér átlátszatlansága (30–100%) |
| **◎** | célzó — felirat kijelölése az oldalon |
| **Mentés** | átirat letöltése `.txt` fájlba |
| **⚙** | beállítások és előzmények |
| **✕** | ablak elrejtése |

A fejlécnél fogva húzható, a jobb alsó saroknál átméretezhető. A pozíciót, méretet,
betűméretet, átlátszóságot és a nézetet **oldalanként megjegyzi**.

### Gyorsbillentyűk

- `Alt` + `Shift` + `T` — ablak mutatása / elrejtése
- `Alt` + `Shift` + `S` — rögzítés indítása / leállítása

Átírhatók a `chrome://extensions/shortcuts` oldalon.

## 5. Mentés és előzmények

- **Élő biztonsági mentés:** minden sor 3 másodpercen belül a tárolóba kerül, tehát ha
  összeomlik vagy véletlenül bezárul a fül, az anyag megmarad
- **Előzmények:** Beállítások → *5. Korábbi felvételek* — dátum, oldal, hossz, sorok száma;
  bármelyik utólag letölthető vagy törölhető
- A `.txt` mindig **mindkét nyelvet** tartalmazza, függetlenül attól, hogy az ablakban
  éppen mi látszik:

```
# Élő feliratfordítás (HU) — A videó címe
# Forrás: https://pelda-stream.hu/video/123
# Rögzítve: 2026-09-04 19:12 – 20:03
# Sorok: 412

[00:01:23]
EREDETI: Hello everyone, welcome back to the show.
HU: Sziasztok, üdv újra a műsorban.
```

## 6. Hogyan találja meg a feliratot?

Két forrást ismer, ebben a sorrendben:

1. **Kijelölt DOM elem** — ha a célzóval kijelöltél egy elemet erre az oldalra, mindig azt
   figyeli (`MutationObserver`). Ha a lejátszó újrarajzolja, fél másodpercenként visszakeresi.
   A célzó nem pontosan arra kattint, amire te: a kattintott szövegdarabkától **felfelé lép**
   addig, amíg a szülő lényegében ugyanazt a szöveget tartalmazza. Így a stabil feliratdobozt
   jelöli ki (YouTube-on pl. a `#ytp-caption-window-container`-t), nem azt a spant, amit a
   lejátszó mondatonként eldob és újragyárt.
2. **A videó saját feliratsávja** (`TextTrack` / `cuechange`) — ha nincs kijelölt elem.
   Ez a megbízhatóbb, ha a lejátszó szabványos HTML5 feliratot használ.

A nyers feliratot nem küldi soronként a DeepL-nek: megvárja a mondat végét (`.` `!` `?`)
vagy azt, hogy a szöveg ne változzon a beállított ideig (alap 1200 ms). Ez nagyjából
harmadára csökkenti az API hívások számát és sokkal jobb fordítást ad. A késleltetés a
beállításokban 300–3000 ms között állítható.

Kezeli a **gördülő feliratot** is (amikor a régi sor felül kicsúszik, miközben alul új
érkezik — a YouTube automatikus felirata pontosan így működik): felismeri a régi és az új
állapot közötti átfedést, így a szöveg se nem duplázódik, se nem vész el belőle rész.

## 7. Ha nem működik

| Tünet | Mit tegyél |
|---|---|
| Nem jelenik meg az ablak | Engedélyezted a domaint? Utána töltsd újra az oldalt (F5). |
| `Extension context invalidated` a konzolban | Ez akkor jön, ha a `chrome://extensions` oldalon frissítetted a bővítményt, miközben az oldal nyitva volt: a régi példány árván marad. Az ablak ilyenkor elhalványul és kiírja, hogy töltsd újra az oldalt — **F5** megoldja. Fejlesztés közben ez normális. |
| „Nem találtam feliratsávot" | Kapcsold be a CC-t a lejátszóban, majd nyomd meg a ◎ célzót és kattints a feliratra. |
| A kijelölt elemben nincs szöveg | Előbb ellenőrizd, hogy be van-e kapcsolva a felirat. Ha be van és látszik is, de a **Diagnosztika** sem talál szöveget, akkor a felirat a **videóképre van égetve** — DOM-ból nem olvasható. Ezt a bővítmény nem tudja kezelni, OCR vagy beszédfelismerés kellene hozzá. |
| A Diagnosztika `videó: 0`-t ír, pedig fut a videó | A lejátszó másik domainről betöltött iframe-ben van. A Diagnosztika felsorolja a beágyazott kereteket (a legnagyobbat elöl) — nyomd meg mellette az *Engedélyezem* gombot, majd F5. Ilyenkor a célzó sem működik a videó fölött: a kattintás az iframe-en belül marad, a főoldal nem kapja meg. |
| „(nincs fordítás)" a sorok mellett | Nézd meg az ablak alsó sávjában a hibaüzenetet: rossz kulcs (403) vagy elfogyott keret (456). Az eredeti szöveg ilyenkor is rögzül. |
| Elveszik a felirat menet közben | A lejátszó kicserélte az elemet. Célozz újra, vagy töröld a szabályt: Beállítások → *4. Kijelölt feliratelemek*, illetve a **Diagnosztika** kártyáján a *Szabály törlése* gombbal. |
| Rossz elemet jelöltél ki (pl. egy menüfeliratot fordít) | Diagnosztika → *Szabály törlése*. Ha nem törlöd, a bővítmény 6 másodperc után magától átvált a videó saját feliratsávjára, ha van ilyen — de a rossz szabály addig is ott marad. |

Hibák keresésekor: `chrome://extensions` → a bővítménynél **service worker** link (háttér
naplója), illetve az oldalon F12 → Console (a content script üzenetei `[LFT]` előtaggal).

## 8. Fájlszerkezet

```
manifest.json
_locales/hu, _locales/en       a felület szövegei (a böngésző nyelve dönt)
background/service-worker.js   DeepL hívások, felvételek, üzenettovábbítás, regisztráció
content/capture.js             felirat kiolvasása, célzó, minden frame-ben fut
content/overlay.js             a lebegő ablak (csak a legfelső frame-ben)
content/overlay-css.js         az ablak stílusa (Shadow DOM-ba, CSP-biztosan)
lib/i18n.js                    nyelvi réteg (chrome.i18n + DOM feliratozás)
lib/store.js                   chrome.storage réteg
lib/deepl.js                   DeepL kliens (endpoint, hibakezelés)
lib/segmenter.js               felirat -> lezárt mondatok, ismétlésszűrés
lib/selector.js                stabil CSS-szelektor a kijelölt elemhez
popup/                         gyorsvezérlő
options/                       beállítások és előzmények
```

## 9. Adatvédelem

- **Nincs szerver a bővítmény mögött.** Nem gyűjt telemetriát, nem küld semmit a szerzőnek.
- **Egyetlen kimenő kapcsolat van:** a lezárt feliratmondatok a te saját DeepL kulcsoddal
  mennek a DeepL API-ra fordításra. Ezt a DeepL adatkezelése szabályozza —
  <https://www.deepl.com/privacy>. Ha ez nem elfogadható egy adott tartalomnál, ne használd ott.
- **Minden más helyben marad:** a DeepL kulcs, az engedélyezett domainek, a kijelölt
  feliratelemek, az ablakbeállítások és a rögzített átiratok a böngésző saját tárolójában
  (`chrome.storage.local`) vannak, azon a gépen. A bővítmény törlésével ezek is törlődnek.
- **A bővítmény csak azokon az oldalakon fut, amelyeket te engedélyezel.** Telepítéskor nem
  kér hozzáférést egyetlen weboldalhoz sem; minden domaint külön, kattintással engedélyezel,
  és bármikor visszavonhatod (Beállítások → *2. Engedélyezett oldalak* → Törlés).
- A DeepL kulcs titkosítatlanul van tárolva. Közös gépen ne használd.

## 10. Licenc

MIT — lásd a [LICENSE](LICENSE) fájlt. Használd, módosítsd, terjeszd szabadon.

A bővítmény nem áll kapcsolatban a DeepL SE-vel, és semmilyen videószolgáltatóval sem.

## 11. Amit szándékosan nem tud (még)

- Saját szótár / glosszárium a szakkifejezésekhez
- `.srt` export időkódokkal
- OCR (ráégetett felirat) és beszédfelismerés
- DeepL-en kívüli fordítómotor
- További felületi nyelvek a magyaron és angolon túl
