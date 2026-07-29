# Disk Temperatures

GNOME Shell 40 extension. Alapértelmezésben a panel **bal** oldalán minden
felismert diszk hőfoka megjelenik eszközcímkével (`sdb 54° nvme0 50° …`), a
legördülő menüben modellnévvel és hőfok szerint rendezve.

## Adatforrások és automatikus felderítés

| Eszköz | Forrás | Privilégium |
|---|---|---|
| ATA HDD és SATA SSD | udisks2 D-Bus: `Drive.Ata.SmartUpdate()` + `SmartTemperature` | nincs |
| NVMe SSD | Kernel `hwmon`, ennek hiányában a felderített `nvme-cli` | általában nincs; jogosultsági hiba esetén opcionális `sudo -n` |
| Rendszerhőmérő és ventilátorok | A `/sys/class/hwmon` felismert szenzorai | nincs |

A SATA-nál nem az udisks ~10 perces SMART cache-ét olvassuk: minden körben
`SmartUpdate()` fut, amit a polkit `org.freedesktop.udisks2.ata-smart-update`
akció `allow_active: yes` beállítása jelszó nélkül engedélyez.

Az NVMe-vezérlőket a bővítmény a `/sys/class/nvme` alatt deríti fel, ezért nincs
beégetett eszköznév vagy darabszám. Elsőként a kernel által biztosított NVMe
`hwmon` hőmérsékletet használja. Ennek hiányában az `nvme` programot a `PATH`,
majd a szokásos rendszerkönyvtárak alapján keresi meg és közvetlenül futtatja.
Csak sikertelen közvetlen olvasás után próbálkozik `sudo -n` tartalék úttal. A
bővítmény soha nem kér jelszót; ha az adott rendszer jogosultságai miatt
NOPASSWD szabály kell, annak a `command -v nvme` által jelzett tényleges
programútvonalra kell vonatkoznia.

## Beállítások

`gnome-extensions prefs disk-temps@lycantrop.hu`, vagy a menü alján
„Beállítások…”. Minden azonnal érvényesül, shell reload nélkül.

| Kulcs | Default | Mit csinál |
|---|---|---|
| `panel-position` | `left` | `left` / `center` / `right` panel-box |
| `panel-index` | `-1` | Sorrend a boxon belül, `-1` = a box végére |
| `panel-mode` | `all` | `all` = minden diszk a panelen, `hottest` = csak a legmelegebb |
| `show-icon` | `true` | Hőmérő ikon a hőfokok előtt |
| `show-dev-label` | `true` | `sdb 54°` vs. puszta `54°` |
| `show-type` | `true` | `HDD` / `SSD` / `NVMe` címke: `sdb HDD 54°` |
| `panel-only-warm` | `true` | Panelen csak a sárga küszöböt elértek + hibás olvasások |
| `panel-order` | `device` | `device` = fix eszköznév sorrend, `temperature` = legmelegebb elöl |
| `refresh-seconds` | `5` | SMART olvasás gyakorisága (1–300) |
| `threshold-hdd-warm` | `45` | HDD sárga küszöb °C |
| `threshold-hdd-hot` | `50` | HDD piros küszöb °C |
| `threshold-ssd-warm` | `55` | SATA SSD sárga küszöb °C |
| `threshold-ssd-hot` | `65` | SATA SSD piros küszöb °C |
| `threshold-nvme-warm` | `60` | NVMe sárga küszöb °C |
| `threshold-nvme-hot` | `70` | NVMe piros küszöb °C |
| `color-cool` | `#8ff0a4` | Hideg szín |
| `color-warm` | `#f8e45c` | Meleg szín |
| `color-hot` | `#ff7b63` | Forró szín (riasztás és ikon is) |
| `color-na` | `#8c8c94` | Ismeretlen / hibás olvasás |
| `dark-menu` | `true` | Saját sötét háttér a lenyíló menünek |
| `show-systin` | `true` | Felismert rendszerhőfok a panelen, az ikon után |
| `show-sensors` | `true` | Felismert rendszerhőfok + mérhető ventilátor-RPM a menü alján |
| `alert-systin` | `44` | Rendszer-/alaplapszenzor riasztási küszöbe °C-ban, `0` = ki |
| `alert-hdd` | `50` | HDD riasztási küszöb °C-ban, `0` = ki |

CLI-ből is állítható:

```bash
SCHEMADIR=~/.local/share/gnome-shell/extensions/disk-temps@lycantrop.hu/schemas
gsettings --schemadir $SCHEMADIR set org.gnome.shell.extensions.disk-temps panel-position right
gsettings --schemadir $SCHEMADIR set org.gnome.shell.extensions.disk-temps panel-mode hottest
```

Schema módosítás után újra kell fordítani:

```bash
glib-compile-schemas ~/.local/share/gnome-shell/extensions/disk-temps@lycantrop.hu/schemas/
```

## Ikon

`icons/disk-temperature-symbolic.svg` — saját rajz, ezért nem függ egy adott
ikontéma hőmérőikon-készletétől. A `-symbolic` névvég miatt a Shell
recolorozza, így a `color` CSS-t követi: az ikon együtt vált sárgára/pirosra a
legmelegebb diszkkel. Csak `fill`-t használ, `stroke`-ot nem (a GTK symbolic
recolor csak a fillt írja át).

**Csapda — ne tegyél negatív margint a stylesheet.css-be.** Egy `margin-right: -2px`
a `.disk-temp-icon`-on negatív szélességet okoz (`Actor 'StBoxLayout' tried to
allocate a size of -24.00 x 28.00`), amitől minden festésnél
`cogl_framebuffer_set_viewport: assertion 'width > 0 && height > 0' failed` jön,
és **az egész felső panel eltűnik** (nem csak ez az indikátor). Térköz csak
pozitív `spacing`/`padding` értékkel.

## Küszöbök és színek

Hat küszöb és négy szín állítható a prefs dialógusban (`Küszöbök` / `Színek`
szekció) vagy `gsettings`-ből. Minden azonnal érvényesül, reload nélkül.

A típusonkénti küszöb szándékos: egy 45 °C-os merevlemez aggasztó, egy 45 °C-os
NVMe teljesen normális. A SATA SSD és az NVMe külön küszöbpárt kap: az NVMe
gyártói üzemi felső határa és szabványos figyelmeztetési pontja magasabb.

A színek **nem** a stíluslapból jönnek: futásidőben állíthatók, ezért a kód
inline `set_style('color: …')`-lal teszi rá őket, ami felülírja a CSS-t. A
`stylesheet.css`-ben lévő négy szín csak tartalék, ha a beállítás olvasása
elbukna.

A GSettings-ből jövő szín inline stílusba kerül, ezért `sanitizeColor()`
ellenőrzi (`^#rrggbb$` vagy `^#rrggbbaa$`), és érvénytelen értéknél a defaultra
esik vissza — egy elgépelt vagy szándékosan rossz érték különben elrontaná a
stílust. Például `red`, `rgba(0,0,0,0)` és `#fff; background: red` mind
elutasított.

Küszöbváltásnál nem elég újraszínezni: megváltozik, hogy melyik diszk esik a
panel szűrésébe, ezért a panel szerkezete is újraépül.

## Sötét menü és a téma

A menü hátterét a shell téma adja. A `Lavanda` például `#FFFFFF` hátteret és
`color: rgba(0,0,0,.6) !important`-ot állít — abban a másodlagos, világos
labeljeink (modellnév, típus, szenzornevek) fehéren fehérek voltak.

Ezért a `dark-menu` a menü actorára tesz egy `disk-temp-menu` class-t, és a
stíluslap **saját sötét hátteret** ad neki, témafüggetlenül. A szelektor
`.popup-menu.disk-temp-menu .popup-menu-content` — két class ugyanazon az
elemen, tehát specifikusabb a téma `.popup-menu .popup-menu-content`-jénél, így
nem a stíluslapok betöltési sorrendjén múlik, melyik győz.

Szándékosan **nincs** széles `StLabel { color }` szabály: az specifikusabb lenne
a hőfok-osztályoknál (`.disk-temp-hot` stb.), és fehérre festené a zöld/sárga/
piros értékeket is. Amelyik labelnek nincs saját class-a (a „Beállítások…"
sora), az kódból kap `disk-temp-menu-text`-et.

`dark-menu = false` esetén a téma színei érvényesülnek — világos témán a
másodlagos szövegek és a zöld/sárga hőfokok nehezen olvashatók lesznek.

## Rendszerszenzorok és ventilátorriasztás

A bővítmény a `/sys/class/hwmon` könyvtárat vizsgálja meg, nem támaszkodik
konkrét `hwmonX` sorszámra, alaplapra vagy hardvermonitor-chipre. A
rendszerhőmérsékletet felirat alapján választja ki; többek között a `SYSTIN`,
`System`, `Motherboard`, `Mainboard`, `Chassis`, `Case`, `Ambient` és `Board`
megnevezéseket ismeri fel. Ha nincs ilyen szenzor, ez a menürész automatikusan
rejtve marad, a lemezhőmérsékletek figyelése tovább működik.

A panelen a felismert rendszerhőfok az ikon után, a diszkek előtt van. Színe az
`alert-systin` beállításhoz igazodik: három fokkal a riasztási küszöb alatt már
sárga. A szenzor fizikai jelentése alaplaponként eltérhet, ezért az
alapértelmezett 44 °C-os küszöböt az adott géphez érdemes igazítani; 0 °C-ra
állítva a riasztás kikapcsolható.

A ventilátorokat a kiválasztott rendszerhőmérővel azonos `hwmon` eszközön
deríti fel. A megjelenített nevet a kernel által közölt ventilátor- vagy
forrásfeliratból képezi; ennek hiányában általános nevet használ. A
ventilátorleállás-figyelés csak olyan csatornán aktiválódik, amelyen az adott
munkamenetben már mért pozitív fordulatszámot. Így egy nem bekötött csatorna
0 RPM értéke nem okoz téves riasztást, egy korábban forgó ventilátor leállása
viszont igen.

Riasztáskor a hőmérő ikon pirosra vált, és a menüben megjelenik egy `⚠` sor az
okkal. Ha a panel épp szűrve van és minden diszk hideg, a riasztás az `OK`
helyére kerül ki. A tachometrikus jel nélkül, például közvetlenül a tápegységről
működő ventilátorok fordulatszáma szoftverből nem olvasható.

## Viselkedés

- `panel-only-warm = true` esetén a panelre az kerül ki, aminek a hőfoka elérte a
  saját sárga küszöbét (HDD 45 °C, SATA SSD 55 °C, NVMe 60 °C), **plusz**
  amelyiknél az olvasás hibázott (`n/a`) — egy nem olvasható diszk figyelmet
  érdemel, nem elrejtést.
  Ha minden diszk hideg, a panel `OK <legmelegebb>°`-ot mutat, nem marad puszta
  ikon.
- A típuscímke (`HDD`/`SSD`/`NVMe`) a kijelzésre szolgál; a `kind` választja ki
  a hozzá tartozó, külön HDD/SATA SSD/NVMe küszöbpárt.
- A menü sorrendje **mindig** hőfok szerint csökkenő, és minden felismert
  diszket tartalmaz, függetlenül a `panel-order`-től és a szűréstől.
- `nowakeup: true` → standby lemez nem pörög fel; ilyenkor az utolsó ismert
  érték látszik `(standby)` jelöléssel.
- Ha az NVMe sem `hwmon`, sem `nvme-cli` segítségével nem olvasható, az adott
  NVMe `n/a`, a lábjegyzet jelzi, a többi diszk változatlanul frissül.
- Hotplug: az udisks eseményeire, valamint az NVMe- és `hwmon` eszközök
  periodikus újrafelderítésekor a lista újraépül.
- Alapértelmezett színküszöbök (`DEFAULT_THRESHOLDS` a `domain.js`-ben):
  HDD 45/50 °C, SATA SSD 55/65 °C, NVMe 60/70 °C.

## Fejlesztés

Az `extension.js` a GNOME Shell-, D-Bus- és widget-életciklust kezeli. A
megjelenítéstől független döntési logika a `domain.js`, a hardverfelderítés
segédfüggvényei pedig a `hardware.js` modulban vannak.

A regressziós ellenőrzések a bővítmény gyökeréből futtathatók:

```bash
make test
```

A telepíthető, minden szükséges modult, ikont és a lefordított sémát tartalmazó
csomag elkészítése:

```bash
make pack
```
