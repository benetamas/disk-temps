# Disk Temperatures

GNOME Shell 40 extension. Default: a panel **bal** oldalán mind a 7 diszk hőfoka
dev címkével (`sdb 54° sde 50° …`), a legördülő menüben modellnévvel és hőfok
szerint rendezve.

## Adatforrások

| Diszktípus | Forrás | Privilégium |
|---|---|---|
| SATA (sda–sde) | udisks2 D-Bus: `Drive.Ata.SmartUpdate()` + `SmartTemperature` | nincs |
| NVMe (nvme0, nvme1) | `sudo -n /usr/sbin/nvme smart-log -o json` | `sudo` (NOPASSWD) |

Miért két forrás: ezen a gépen sem `CONFIG_SENSORS_DRIVETEMP`, sem
`CONFIG_NVME_HWMON` nincs bekapcsolva, tehát hwmon sysfs-ből nem jön lemezhőfok.
Az udisks2 2.9.4 csak ATA diszkeket ismer (NVMe támogatás 2.10+), ezért az NVMe
külön ágon megy. A `/dev/nvme*` node-ok `0600 root:root`, ezért kell hozzájuk sudo.

A SATA-nál nem az udisks ~10 perces SMART cache-ét olvassuk: minden körben
`SmartUpdate()` fut, amit a polkit `org.freedesktop.udisks2.ata-smart-update`
akció `allow_active: yes` beállítása jelszó nélkül engedélyez.

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
| `show-systin` | `true` | Ház hőfok a panelen (`ház 38°`), az ikon után |
| `show-sensors` | `true` | SYSTIN + mérhető ventilátor RPM a menü alján |
| `alert-systin` | `44` | Ház-ambient riasztási küszöb °C-ban, `0` = ki |
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

`icons/disk-temperature-symbolic.svg` — saját rajz, mert az Adwaitában ezen a
gépen nincs hőmérő ikon. A `-symbolic` névvég miatt a Shell recolorozza, így a
`color` CSS-t követi: az ikon együtt vált sárgára/pirosra a legmelegebb diszkkel.
Csak `fill`-t használ, `stroke`-ot nem (a GTK symbolic recolor csak a fillt írja át).

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

## Ház-szenzorok és riasztás

A tápra (Molex/SATA) közvetlenül kötött ventilátorok RPM-je **elvileg nem
olvasható**: a tacho a csatlakozó 3. vezetéke, ami ott nincs bekötve. Ezen a
gépen alternatív út sincs — nincs digitális táp USB-n, és a `corsair_psu` /
`aquacomputer_d5next` / `nzxt_smart2` driverek nem léteznek AlmaLinux 9-en.
Egyetlen fan-input forrás van: `nct6798`, 7 csatorna.

### Miért van a ház hőfoka a panelen

A `SYSTIN` nem melléklet, hanem a **vezető indikátor**, ezért `show-systin`
alapból be van kapcsolva:

- ez vezérli a ventilátor-görbét (mind a három ház-venti `temp_sel=1`, knee 42 °C)
- előbb emelkedik, mint a lemezek hőfoka, tehát előrejelzi a problémát
- a tápra kötött ventilátorok RPM-je fizikailag nem olvasható, így egy leállásuk
  **csak** a SYSTIN emelkedéséből derül ki

A panelen az ikon után, a diszkek **előtt** van, fix helyen — a diszklista hossza
a szűrés miatt változik, a ház-érték nem ugrálhat vízszintesen. A
`panel-only-warm` szűrés nem érinti: hidegen is látszik.

Színe nem a diszk-küszöbökhöz, hanem az `alert-systin`-hez igazodik (3 fokkal
alatta már sárga). A `systinLevel()` egyetlen függvényben van, és a menüsor is
azt hívja — különben a két kijelzés elcsúszhatna egymástól.

### A ventilátorok figyelése

Ezért a **következményt** figyeljük, nem az RPM-et:

- `ház (SYSTIN)` — ház-ambient hőmérséklet
- `fanN (…)` — csak azok a csatornák, amiket **már láttunk forogni**. Így az üres
  headerek nem szemetelik a listát, egy szabad headerre átdugott ventilátor
  magától megjelenik, és ha egy addig működő ventilátor leáll, **`ÁLL`** lesz
  belőle 0 RPM-mel — ez a hibadetektor.

Mért headerek (`nct6798`, ASRock Z490 Pro4), 100% PWM-es spin-up teszttel:

| Header | Mi van rajta | Indulási küszöb | RPM 100%-on |
|---|---|---|---|
| fan2 | CPU ventilátor | – | 1687 |
| fan4 | ház ventilátor | pwm 102 (40%) | 703 |
| fan5 | ház ventilátor | pwm 102 (40%) | 1092 |
| fan6 | ház ventilátor | pwm 90 (35%) | 1015 |
| fan1, fan3, fan7 | üres | – | 0 |

A `fan1`/`fan3`/`fan7` 100% PWM-en is 0 RPM, tehát nincs rajtuk semmi. A 0 RPM
önmagában **nem** bizonyíték: egy bekötött ventilátor is 0-t mutat az indulási
küszöbe alatt — ezért kell a spin-up teszt (`sudo`-val `pwmN_enable=1` +
`pwmN=255` pár másodpercre, majd vissza `enable=5`-re).

Riasztáskor (SYSTIN vagy HDD küszöb átlépve, vagy egy ismert ventilátor leállt)
a hőmérő ikon pirosra vált, és a menüben megjelenik egy `⚠` sor az okkal. Ha a
panel épp szűrve van és minden diszk hideg, a riasztás az `OK` helyére kerül ki —
különben egy „OK" mögé rejtenénk el a problémát.

Az `alert-systin` default 44 °C, mert a ventilátor-görbe 42 °C-on már 100%-on
van: ha a ház ezt is átlépi, a hűtés tényleg nem elég. Terhelés alatt a 39-40 °C
normális, azon riasztani hamis pozitív lenne.

## Viselkedés

- `panel-only-warm = true` esetén a panelre az kerül ki, aminek a hőfoka elérte a
  saját sárga küszöbét (HDD 45 °C, SATA SSD 55 °C, NVMe 60 °C), **plusz**
  amelyiknél az olvasás hibázott (`n/a`) — egy nem olvasható diszk figyelmet
  érdemel, nem elrejtést.
  Ha minden diszk hideg, a panel `OK <legmelegebb>°`-ot mutat, nem marad puszta
  ikon.
- A típuscímke (`HDD`/`SSD`/`NVMe`) a kijelzésre szolgál; a `kind` választja ki
  a hozzá tartozó, külön HDD/SATA SSD/NVMe küszöbpárt.
- A menü sorrendje **mindig** hőfok szerint csökkenő, és **mindig mind a hét
  diszket** tartalmazza, függetlenül a `panel-order`-től és a szűréstől.
- `nowakeup: true` → standby lemez nem pörög fel; ilyenkor az utolsó ismert
  érték látszik `(standby)` jelöléssel.
- Ha a `sudo` megtagadja az NVMe olvasást, a két NVMe `n/a`, a lábjegyzet jelzi,
  a SATA diszkek változatlanul frissülnek.
- Hotplug: udisks `InterfacesAdded`/`InterfacesRemoved` eventre a lista újraépül.
- Alapértelmezett színküszöbök (`DEFAULT_THRESHOLDS` a `domain.js`-ben):
  HDD 45/50 °C, SATA SSD 55/65 °C, NVMe 60/70 °C.

## Fejlesztés

Az `extension.js` a GNOME Shell-, D-Bus- és widget-életciklust kezeli. A
megjelenítéstől független döntési logika a `domain.js` modulban van: átváltás,
küszöbszintek, figyelmeztetés, eszköz- és hőfok szerinti rendezés, rövid címkék,
valamint a beállított színek validálása.

A domain regressziós ellenőrzései a bővítmény gyökeréből futtathatók:

```bash
gjs tests/domain.test.js
```
