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
2. Bővítmény ikon → **Beállítások és előzmények** → *DeepL API kulcs*
3. Írd be a kulcsot, majd nyomd meg a **Teszt** gombot

A Free kulcs `:fx`-re végződik — a bővítmény ebből ismeri fel, melyik DeepL végpontot
kell hívnia, tehát Pro kulcsot is beírhatsz később, kódmódosítás nélkül.

A kulcs **titkosítatlanul**, a böngésző saját tárolójában marad ezen a gépen.

### Célnyelv

Beállítások → *Fordítás és megjelenés* → **Célnyelv**. A legördülő menüben a DeepL összes
célnyelve szerepel (magyar, német, spanyol, japán, ukrán és a többi).

A **forrásnyelvet nem kell megadni** — a DeepL magától felismeri, tehát ugyanaz a beállítás
működik angol, német vagy spanyol nyelvű felirathoz is.

A lista beépítve is megvan, de amint megadod a kulcsot, a bővítmény lekéri a DeepL-től
a **valóban aktuális** listát, így az újonnan támogatott nyelvek is megjelennek. Kézzel a
*Lista frissítése* gombbal is elkérhető. A fordítóablak fejléce mindig mutatja az aktuális
célnyelvet (pl. `→ HU`).

### Szakszótár

Ha a DeepL következetlenül fordít egy-egy szakkifejezést, Beállítások → **Szakszótár**
alatt megadhatod, minek fordítsa. Soronként egy pár:

```
polyvagal = polivagális
autonomic nervous system = autonóm idegrendszer
neuroception = neurocepció
# a # jellel kezdődő sor megjegyzés
```

Elválasztónak az `=` mellett a tabulátor, a `→` és a `;` is jó. Az **Ellenőrzés és
feltöltés** gomb megmondja, hány pár érvényes, kiírja a hibás sorokat, és feltölti a
szótárt a DeepL-hez.

Ez a DeepL saját szótárfunkciója, nem utólagos csere: a fordítás **közben** érvényesül,
így a ragozott alakokra is hat. Két dolgot érdemes tudni:

- A DeepL megköveteli a forrásnyelv ismeretét, mi viszont felismertetjük vele. Ezért a
  szótár **az első lefordított mondat után** lép életbe — onnantól végig érvényes.
- A célnyelv váltásakor a bővítmény ugyanezekből a párokból új szótárt tölt fel. A párok
  értelemszerűen az adott célnyelvhez tartoznak, tehát más nyelvre váltva érdemes átírni őket.

Ha a feltöltés bármi okból nem sikerül, a fordítás **szótár nélkül megy tovább** — nem áll
meg emiatt semmi —, a hibát pedig az Ellenőrzés gomb kiírja.

## 3. Felolvasás (Google Cloud TTS) — nem kötelező

A lefordított sorokat hangosan is felolvastathatod, ahogy megérkeznek.

1. A [Google Cloud konzolban](https://console.cloud.google.com/) engedélyezd a
   **Cloud Text-to-Speech API**-t, majd hozz létre egy **API kulcsot**
2. Beállítások → *Felolvasás* → írd be a kulcsot → **Teszt** (lejátszik egy hangmintát)
3. Pipáld ki a **Felolvasás bekapcsolása** jelölőt, és válassz **hangot**

A hanglista a célnyelvhez igazodik: ha átállítod a fordítás célnyelvét, a bővítmény
magától lekéri az ahhoz tartozó hangokat, és a **Chirp3 HD** hangokat teszi előre — azok
szólnak a legtermészetesebben. A **beszédtempó** 0,25× és 2× között állítható; élő
felirathoz gyakran jól jön az 1,1–1,3.

Menet közben a fordítóablak **🔊 / 🔇** gombjával kapcsolhatod ki-be.

### Az eredeti hang lehalkítása

Amíg a fordítás hangja szól, a videó saját hangja lehalkul, utána visszaáll — így a két
beszéd nem megy egymásra. A mértéke a beállításokban állítható (*Eredeti hang a felolvasás
alatt*), alapban **20%**; a 0% teljes némítást jelent.

A halkítás rövid átmenettel történik, hogy ne kattanjon, és **egymás utáni mondatok között
nem áll vissza** — csak akkor, amikor a felolvasás tényleg elhallgat. Ha a lejátszó
beágyazott keretben van, ez is működik, feltéve hogy annak a keretnek a domainjét
engedélyezted.

**Hogyan működik:** a hangok szigorúan **egymás után** szólalnak meg, a felirat
sorrendjében — soha nem csúsznak egymásra.

A bővítmény **nem várakozik szövegre**: amint van mit mondani, kimondja. Ha viszont épp
szól egy hang, az addig érkező darabokat **egyetlen hanggá vonja össze**. Így kevesebb és
hosszabb hangfájl lesz — kevesebb szünettel a mondatok között, és természetesebb
hangsúlyozással, mert a TTS összefüggő szöveget kap, nem külön töredékeket. Késleltetést
ez nem okoz: csak azt fogja össze, ami úgyis sorban állt volna.

Nagyon nagy torlódásnál a legrégebbi darabokat eldobja, hogy felzárkózzon a jelenhez;
az átiratban természetesen minden sor megmarad.

> A Google Cloud TTS **külön fizetős szolgáltatás**, havi ingyenes kerettel — a DeepL
> kulcstól teljesen független. A kulcsot a Google konzolban érdemes a Text-to-Speech
> API-ra korlátozni.

## 4. Oldal engedélyezése

A bővítmény csak az általad felsorolt oldalakon fut.

- **A legegyszerűbb:** Beállítások → *Automatikus működés* → **Engedélyezem minden
  oldalon**. Ez egyetlen engedélykérés, és utána soha többé nem kérdez semmit —
  sem oldalanként, sem a beágyazott keretekre. (A popupban is ott a gomb.)
- **Gyorsan, csak erre az oldalra:** menj a kívánt oldalra, kattints a bővítmény
  ikonjára → *Engedélyezés ezen az oldalon*
- **Vagy:** Beállítások → *Engedélyezett oldalak* → írd be a domaint (pl.
  `pelda-stream.hu`) → **Hozzáadás**

> A böngésző engedélykérő ablakát a bővítmény **nem tudja magától elfogadni** —
> ezt a Chrome tiltja, épp azért, hogy egy bővítmény ne szerezhessen magának
> jogosultságot a hátad mögött. Amit meg lehet tenni, az az, hogy egyszer kérünk
> engedélyt mindenre, és utána nincs több kérdés.

A *Minden oldalon* engedélyt bármikor visszavonhatod ugyanott a **Visszavonom**
gombbal.

Az aldomainek automatikusan beleértendők.

> **Ha a lejátszó egy másik domainről érkező iframe-ben van** (pl. `player.masikcdn.com`),
> azt a domaint is hozzá kell adni, különben a bővítmény nem lát bele. Nem kell keresgélned:
> a **Diagnosztika** felsorolja az oldal beágyazott kereteit, és mindegyik mellett van egy
> *Engedélyezem* gomb. Ez böngésző-biztonsági határ — idegen domainről betöltött keret
> tartalmát semmilyen trükkel nem lehet kiolvasni engedély nélkül.

### Automatikus működés

A *Beállítások → Automatikus működés* alatt két kapcsoló van, mindkettő alapból
bekapcsolva:

| Kapcsoló | Mit csinál |
|---|---|
| **Feliratsáv magától bekapcsolva** | Ha a videónak van feliratsávja, de ki van kapcsolva, a bővítmény `hidden` módban bekapcsolja. A szöveget megkapja, de **a videó képén nem jelenik meg felirat**, tehát nem változik, amit látsz. Leállításkor visszaállítja az eredeti állapotot. |
| **Automatikus indítás, ha van felirat** | Ha egy már játszó videón feliratot talál, magától megnyílik az ablak és elindul a fordítás. Oldalbetöltésenként egyszer sül el: ha leállítod, nem indul újra a hátad mögött. |

Az automatikus indításhoz kell a DeepL kulcs — anélkül nem indul el magától.

> **Vigyázz a kerettel:** az automatikus indítás minden feliratos videónál fogyasztja
> a DeepL karakterkeretedet, akkor is, ha közben mást csinálsz. Ha fogyóban a keret,
> kapcsold ki, és indítsd kézzel a **Start** gombbal.

## 5. Használat

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
| **🔊 / 🔇** | felolvasás be- és kikapcsolása |
| **Mentés** | átirat letöltése `.txt` fájlba |
| **⚙** | beállítások és előzmények |
| **✕** | ablak elrejtése |

A fejlécnél fogva húzható, a jobb alsó saroknál átméretezhető. A pozíciót, méretet,
betűméretet, átlátszóságot és a nézetet **oldalanként megjegyzi**.

### Gyorsbillentyűk

- `Alt` + `Shift` + `T` — ablak mutatása / elrejtése
- `Alt` + `Shift` + `S` — rögzítés indítása / leállítása

Átírhatók a `chrome://extensions/shortcuts` oldalon.

## 6. Mentés és előzmények

- **Élő biztonsági mentés:** minden sor 3 másodpercen belül a tárolóba kerül, tehát ha
  összeomlik vagy véletlenül bezárul a fül, az anyag megmarad
- **Előzmények:** Beállítások → *Korábbi felvételek* — dátum, oldal, hossz, sorok száma;
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

### Beállítások átvitele másik gépre

Beállítások → *Beállítások mentése és visszatöltése*. A **Mentés fájlba** egyetlen JSON-be
teszi a kulcsokat, az engedélyezett oldalakat, a kijelölt feliratelemeket és a
hangbeállításokat; a másik gépen a **Visszatöltés fájlból** olvassa be. A rögzített
átiratok nincsenek benne — azokat a felvételeknél töltheted le külön.

Az **API kulcsokat is mentse** jelölő kikapcsolható. Ha bent hagyod, a fájl olvasható
formában tartalmazza a DeepL és a Google kulcsodat — kezeld úgy, mint egy jelszót.

Visszatöltés után az oldalak megjelennek a listán, de a böngésző az engedélyt csak
kattintásra adja meg: nyomd meg mellettük az **Engedélyezem** gombot.

## 7. Hogyan találja meg a feliratot?

**Magától keres**, kattintás nélkül, ebben a sorrendben:

1. **Kijelölt DOM elem** — ha a célzóval kijelöltél egyet erre az oldalra, az az erősebb;
   azt figyeli (`MutationObserver`), és ha a lejátszó újrarajzolja, fél másodpercenként
   visszakeresi. A célzó nem pontosan arra kattint, amire te: a kattintott szövegdarabkától
   **felfelé lép** addig, amíg a szülő lényegében ugyanazt a szöveget tartalmazza. Így a
   stabil feliratdobozt jelöli ki, nem azt a spant, amit a lejátszó mondatonként eldob és
   újragyárt. Ha a saját szabályod 8 másodpercig egy szót sem ad, magától keres helyette mást.
2. **A videó saját feliratsávja** (`TextTrack` / `cuechange`). Ha a sáv ki van kapcsolva,
   `hidden` módban bekapcsolja — így megkapja a szöveget anélkül, hogy a videó képén
   felirat jelenne meg. Videónként **egy** sávot köt be, különben két nyelv mondatai
   keverednének össze.
3. **Ismert lejátszók felirat-konténere** — YouTube, Video.js, JW Player, Shaka, Plyr,
   Bitmovin, Vimeo. Ezeken nem kell célozni, a bővítmény tudja, hol keresse.
4. **Találgatás** — `caption` / `subtitle` / `cue` osztálynevek és `aria-live` alapján.

Amíg tényleg nem jön szöveg, fél másodpercenként újrapróbálja az egészet: a lejátszók
gyakran csak jóval a betöltés után építik fel a felirat elemét.

A nyers feliratot nem küldi soronként a DeepL-nek: megvárja a mondat végét (`.` `!` `?`)
vagy azt, hogy a szöveg ne változzon a beállított ideig (alap 1200 ms). Ez nagyjából
harmadára csökkenti az API hívások számát és sokkal jobb fordítást ad. A késleltetés a
beállításokban 300–3000 ms között állítható.

Kezeli a **gördülő feliratot** is (amikor a régi sor felül kicsúszik, miközben alul új
érkezik — a YouTube automatikus felirata pontosan így működik): felismeri a régi és az új
állapot közötti átfedést, így a szöveg se nem duplázódik, se nem vész el belőle rész.

Az **időkódokat kiszűri** a felirat szövegéből. Az átirat-panelek (például a YouTube
„Átirat" nézete) minden sor elé odaírják, hogy `0:12` — ez nem a felirat része, csak
elrontaná a fordítást. A beszédben elhangzó időpont (`we meet at 3:30`, `3:30 PM`)
viszont megmarad. A mentett fájl saját `[00:01:23]` időbélyege ettől független, azt a
videó lejátszási idejéből írjuk.

## 8. Ha nem működik

| Tünet | Mit tegyél |
|---|---|
| Nem jelenik meg az ablak | Engedélyezted a domaint? Utána töltsd újra az oldalt (F5). |
| `Extension context invalidated` a konzolban | Ez akkor jön, ha a `chrome://extensions` oldalon frissítetted a bővítményt, miközben az oldal nyitva volt: a régi példány árván marad. Az ablak ilyenkor elhalványul és kiírja, hogy töltsd újra az oldalt — **F5** megoldja. Fejlesztés közben ez normális. |
| „Nem találtam feliratsávot" | Kapcsold be a CC-t a lejátszóban, majd nyomd meg a ◎ célzót és kattints a feliratra. |
| A kijelölt elemben nincs szöveg | Előbb ellenőrizd, hogy be van-e kapcsolva a felirat. Ha be van és látszik is, de a **Diagnosztika** sem talál szöveget, akkor a felirat a **videóképre van égetve** — DOM-ból nem olvasható. Ezt a bővítmény nem tudja kezelni, OCR vagy beszédfelismerés kellene hozzá. |
| A Diagnosztika `videó: 0`-t ír, pedig fut a videó | A lejátszó másik domainről betöltött iframe-ben van. A Diagnosztika felsorolja a beágyazott kereteket (a legnagyobbat elöl) — nyomd meg mellette az *Engedélyezem* gombot, majd F5. Ilyenkor a célzó sem működik a videó fölött: a kattintás az iframe-en belül marad, a főoldal nem kapja meg. |
| „(nincs fordítás)" a sorok mellett | Nézd meg az ablak alsó sávjában a hibaüzenetet: rossz kulcs (403) vagy elfogyott keret (456). Az eredeti szöveg ilyenkor is rögzül. |
| Elveszik a felirat menet közben | A lejátszó kicserélte az elemet. Célozz újra, vagy töröld a szabályt: Beállítások → *Kijelölt feliratelemek*, illetve a **Diagnosztika** kártyáján a *Szabály törlése* gombbal. |
| Rossz elemet jelöltél ki (pl. egy menüfeliratot fordít) | Diagnosztika → *Szabály törlése*. Ha nem törlöd, a bővítmény 6 másodperc után magától átvált a videó saját feliratsávjára, ha van ilyen — de a rossz szabály addig is ott marad. |

Hibák keresésekor: `chrome://extensions` → a bővítménynél **service worker** link (háttér
naplója), illetve az oldalon F12 → Console (a content script üzenetei `[LFT]` előtaggal).

## 9. Fájlszerkezet

```
manifest.json
_locales/hu, _locales/en       a felület szövegei (a böngésző nyelve dönt)
background/service-worker.js   DeepL hívások, felvételek, üzenettovábbítás, regisztráció
content/capture.js             felirat kiolvasása, célzó, minden frame-ben fut
content/overlay.js             a lebegő ablak (csak a legfelső frame-ben)
content/overlay-css.js         az ablak stílusa (Shadow DOM-ba, CSP-biztosan)
lib/i18n.js                    nyelvi réteg (chrome.i18n + DOM feliratozás)
lib/tts.js                     Google Cloud TTS kliens (hangok, szintézis)
lib/store.js                   chrome.storage réteg
lib/deepl.js                   DeepL kliens (endpoint, hibakezelés)
lib/segmenter.js               felirat -> lezárt mondatok, ismétlésszűrés
lib/selector.js                stabil CSS-szelektor a kijelölt elemhez
popup/                         gyorsvezérlő
options/                       beállítások és előzmények
```

## 10. Adatvédelem

- **Nincs szerver a bővítmény mögött.** Nem gyűjt telemetriát, nem küld semmit a szerzőnek.
- **Kimenő kapcsolat csak a fordításhoz és a felolvasáshoz van:** a lezárt feliratmondatok a
  te saját DeepL kulcsoddal mennek a DeepL API-ra, és ha bekapcsolod a felolvasást, a
  lefordított mondatok a te saját Google kulcsoddal a Google Cloud TTS-re. Ezt a DeepL adatkezelése szabályozza —
  <https://www.deepl.com/privacy>. Ha ez nem elfogadható egy adott tartalomnál, ne használd ott.
- **Minden más helyben marad:** a DeepL kulcs, az engedélyezett domainek, a kijelölt
  feliratelemek, az ablakbeállítások és a rögzített átiratok a böngésző saját tárolójában
  (`chrome.storage.local`) vannak, azon a gépen. A bővítmény törlésével ezek is törlődnek.
- **A bővítmény csak azokon az oldalakon fut, amelyeket te engedélyezel.** Telepítéskor nem
  kér hozzáférést egyetlen weboldalhoz sem; minden domaint külön, kattintással engedélyezel,
  és bármikor visszavonhatod (Beállítások → *Engedélyezett oldalak* → Törlés).
- A DeepL kulcs titkosítatlanul van tárolva. Közös gépen ne használd.

## 11. Licenc

MIT — lásd a [LICENSE](LICENSE) fájlt. Használd, módosítsd, terjeszd szabadon.

A bővítmény nem áll kapcsolatban a DeepL SE-vel, és semmilyen videószolgáltatóval sem.

## 12. Amit szándékosan nem tud (még)

- `.srt` export időkódokkal
- OCR (ráégetett felirat) és beszédfelismerés (STT)
- DeepL-en kívüli fordítómotor
- További felületi nyelvek a magyaron és angolon túl
