# Pausefisk

En nedtælling til pauser (fx mellem præsentationer på et kursus) vist oven på et 3D-akvarie med svømmende fisk. Bygget med [Babylon.js](https://www.babylonjs.com/) og [Vite](https://vite.dev/).

## Kom i gang

Kræver [Node.js](https://nodejs.org/) 20 eller nyere.

```bash
npm install     # henter Babylon.js, Vite og skrifttypen
npm run dev     # starter en udviklingsserver, typisk på http://localhost:5173
```

## Læg den på en web-server

```bash
npm run build
```

Kopiér indholdet af `dist/` til en mappe på web-serveren (fx `/var/www/html/pause/`). Det er ren statisk HTML/JS, så det kræver ingen særlig server, container eller port, og siden virker også uden internetadgang.

Siden skal åbnes via en web-server – dobbeltklik på `index.html` (`file://`) virker ikke, fordi browseren blokerer indlæsning af modellerne.

## Brug

- Vælg antal minutter på startskærmen, eller start direkte med `?min=10` i adressen.
- Skriv evt. en besked, der vises under uret (fx "Næste: Modul 3"). Den huskes til næste gang, og `&besked=...` i adressen sætter den.
- "Vis kun akvariet" viser akvariet uden ur – fx før kurset starter eller i frokostpausen. `R` eller `Esc` går tilbage. `?akvarie` i adressen starter direkte i den tilstand.
- Kontakten "Lille ur i hjørnet" viser uret småt nede i hjørnet, så akvariet får hele scenen; når der er 5 minutter tilbage, bliver det stort igen. `&hjoerne` i adressen slår det til.
- Uret kan vises i stor, mellem (standard) eller lille størrelse, og valget huskes til næste gang.
- Urets farve vælges med farveknapperne på startskærmen (hvid, turkis, mint, gul, lyserød eller lavendel) og huskes til næste gang. `&farve=turkis` i adressen sætter den.
- Akvariet har tre døgn-temaer: morgen, middag og aften. Temaet farver vandet, lyset og lysstrålerne fra overfladen.
- Skærmen holdes tændt, mens nedtællingen eller akvariet kører (Screen Wake Lock), så den ikke går i dvale midt i pausen.
- Kontakten "Klokke" (slået til som standard) spiller en blød klokke, når tiden er gået, og et enkelt diskret ding, når der er ét minut tilbage. Lyden er genereret i browseren – der er ingen lydfiler – og browseren tillader først lyd efter et klik på siden. Der er bevidst ingen baggrundslyd, så underviseren kan afspille sin egen pausemusik.
- Kontakten "Fiskene dør, når tiden er gået" er slået fra som standard og huskes i browseren. `&doede` i adressen slår den til (fx `?min=10&doede`).
- Uret glider fra den valgte farve over i orange de sidste 5 minutter og bliver rødt med minus, når tiden er overskredet.
- Akvariet følger nedtællingen: i det sidste minut samler fiskene sig midt i billedet, og de sidste 10 sekunder danner stimen selve tallene 10, 9, 8 … 0, mens uret træder i baggrunden. Ved 0 eksploderer stimen ud til alle sider. Når tiden er gået, bliver lyset en anelse varmere, og har man valgt det, dør fiskene og falder til bunds med bugen opad. Lægges der tid til, stiger en boblesky op, og fiskene vender sig og svømmer videre.
- Hvert halve til hele minut sker der noget særligt i akvariet – i blandet rækkefølge, så man ser dem alle, før nogen gentages:
  - en dykker der svømmer forbi med flagspark og bobler (`?dykker`)
  - en lille flok lysende vandmænd der pulserer sig op gennem vandet (`?vandmand`)
  - et skibsvrag der synker fra overfladen og lægger sig på bunden (`?vrag`)
  - en pukkelhval der glider langsomt forbi højt oppe, så dens skygge driver hen over sandet (`?hval`)
  - en sortspidset revhaj der ofte går på jagt og skyder igennem stimen, som splitter op omkring den (`?haj`; `?jagt` sender en jagende haj)
  - en flok delfiner der cirkler om stimen og skyder igennem den (`?delfiner`)
  - en spækhugger med sin unge (`?spaekhugger`)
  - krabber der går sidelæns over sandet, knipser med kløerne og graver sig ned (`?krabber`)
  - en mantarokke der slår en kolbøtte midt i billedet (`?rokke`)
  - en havskildpadde der svømmer op mod overfladen for at trække vejret (`?skildpadde`)
  - en blæksprutte der træder frem fra sin camouflage, skifter farve og forsvinder i en sky af blæk (`?blaeksprutte`)
  - kun om aftenen: lysende morild der gnistrer, hvor stimen svømmer (`?plankton`)
  - kun om morgenen: solglimt med kraftige lysstråler og gyldent støv (`?solglimt`)

  Parameteren i parentes starter hændelsen med det samme (fx `?akvarie&hval`). I det sidste minut af nedtællingen starter der ingen hændelser, og en igangværende toner ud, så stimen og tallene får scenen.
- Over fiskene ses vandoverfladen nedefra som et bølgende lysnet. Kameraet driver langsomt, når ingen rører det, og fiskene har et dansende lysnet (kaustik) og en svag lyskant.
- Havbunden har koraller, søanemoner og vifter der vajer, søstjerner og sandriller. Klovnefiskene holder til ved hver sin anemone, nogle arter svømmer nede ved bunden, og fladfiskene ligger på siden i sandet og glider indimellem et stykke.

| Tast | Funktion |
|---|---|
| Mellemrum | Pause / fortsæt |
| 1, 2, 5 (eller knapperne i bjælken) | Læg 1, 2 eller 5 minutter til |
| + / − | Læg et minut til / træk et fra |
| M | Klokke til/fra |
| F | Fuldskærm |
| R | Ny nedtælling |

## Filer

| Sti | Indhold |
|---|---|
| `index.html` | Siden: canvas, startpanel og ur |
| `src/main.js` | Akvariet: kamera, lys, bund, tang, bobler og de enkelte fisk; kobler nedtællingen til akvariet |
| `src/aquarium.js` | Fælles mål og tilstand (svømmeområde, samling/spredning, store fisk de andre viger for) |
| `src/fishModels.js` | Indlæsning af de animerede FBX-fisk og blanding af svømme-animationerne |
| `src/school.js` | Fiskestimen (boids) |
| `src/rareEvents.js` | Styrer de sjældne hændelser: blandet rækkefølge, ventetid og pause i sidste minut |
| `src/events/` | Én fil pr. hændelse (dykker, vandmænd, vrag, hval/delfiner/spækhugger, haj, krabber, rokke, skildpadde, blæksprutte, morild/solglimt) og `creature.js`, der bygger de lavpolygon-dyr, som hvaler, delfiner og hajen er lavet af |
| `src/caustics.js` | Det fælles lysnet (kaustik) og material-plugin til fisk, sten og tang |
| `src/cameraDrift.js` | Kameraets langsomme drift |
| `src/seabed.js` | Havbunden: koraller, anemoner, vifter, søstjerner, sandriller og vaje-effekten |
| `src/sound.js` | Klokken, genereret med Web Audio |
| `src/water.js` | Vandet: dybde-gradient, kaustik på bunden, lysstråler, svævende partikler og efterbehandling (bloom, vignet) |
| `src/countdown.js`, `src/countdown.css` | Nedtællingen og dens udseende |
| `vite.config.js` | Byggeopsætning; kopierer `assets/FBX` med i `dist/` |
| `assets/FBX/` | Fiskemodellerne med skelet og svømme-animationer |

## Licens

Koden er udgivet under MIT-licensen (se `LICENSE`). Fiskemodellerne er CC0 (se nedenfor).

## Credits

Fiskemodellerne er [LowPoly Fish af Quaternius](https://quaternius.com/), udgivet under CC0 (se `assets/License.txt`).
