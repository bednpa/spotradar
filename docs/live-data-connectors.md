# Live availability for Brno courts – venues, booking systems and connectors

SpotRadar searches seven sports (`SPORTS` in `shared/src/catalog.ts`): badminton, tennis, squash,
padel, table tennis, volleyball and beach volleyball. A venue has one **offering** per sport
(`SportOffering`: courts, hours incl. season, booking page, booking system, prices, MultiSport) and,
in the backend, one connector `source` per offering (`SportOfferingConfig`). Connectors receive
only `{ venueId, sport, source }`, never a city or venue name, so Prague venues on the same systems
need only new data entries.

## Brno venue research (2026-11-25)

Researched for every sport; "free slots w/o login" was checked by fetching the schedule page.
Values we could not confirm are stored as unknown (no `openingHours`, no `pricing`,
`multisport: { category: 'unknown' }`), never guessed.

| Venue                             | Sports in SpotRadar                                | Booking system                  | Public schedule                                                     | Free slots w/o login                  | In SpotRadar                  |
| --------------------------------- | -------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------- | ------------------------------------- | ----------------------------- |
| Centrum Viktoria                  | badminton, squash, padel, beach volleyball, tennis | ClubSpire                       | `rezervace.centrumviktoria.cz:18443/timeline/day?tabIdx=`           | yes (tabs 0 squash, 1, 2 beach, 3)    | live; tennis "check" ¹        |
| Sportcentrum Kuklenská            | badminton                                          | ClubSpire                       | `kuklenska.clubspire.cz/timeline/day?tabIdx=0`                      | yes                                   | live                          |
| Fitness Boby                      | squash                                             | ClubSpire                       | `rezervace.fitnessboby.cz:28080/timeline/day?tabIdx=4`              | yes                                   | live                          |
| Hala Sprint                       | badminton, tennis (6 indoor)                       | MemberZone                      | `memberzone.cz/sprint_tenis/Sportoviste.aspx?ID_Sportoviste=3 / =1` | yes                                   | live                          |
| Sportcentrum Ivanovice            | badminton, squash, table tennis                    | MemberPro                       | `memberzone.cz/ivanovice/` (BTN5 / BTN4 / BTN3)                     | yes                                   | live                          |
| Badminton Jehnice, Líšeň, X-Arena | badminton                                          | Bizzy                           | `*.e-rezervace.cz/Branch/pages/Schedule.faces`                      | yes, but refuses data-centre IPs      | live / `unavailable`          |
| Beach Riviéra (STAREZ)            | beach volleyball (6, heated hall in winter)        | STAREZ (own, `*.starez.cz`)     | `beach.starez.cz/vstupenky-rezervace`                               | yes (server-rendered)                 | live (**new connector**)      |
| Padel Powers Slatina              | padel (10 indoor)                                  | PadelOS                         | `player.padelos.co/company/217?clubIds=216930`                      | unknown (JS app) ²                    | check on website              |
| Padel Powers Kraví hora           | padel (4 outdoor)                                  | PadelOS                         | `player.padelos.co/company/217?clubIds=216928`                      | unknown (JS app) ²                    | check on website              |
| Padel Club Brno                   | padel (4, closed in winter)                        | own                             | `padelclub.cz/rezervace`                                            | no (script + login)                   | check on website              |
| Club Classic                      | tennis (10), beach volleyball (4), table tennis    | unknown                         | `rezervace.clubclassic.cz`                                          | refused (HTTP 403)                    | check on website              |
| Kraví hora beach                  | beach volleyball (2, May–Oct)                      | own client zone                 | `zakaznik.kravihora-brno.cz/kzona`                                  | grid public, cells not verified       | check on website (closed now) |
| Tenis Paradise                    | tennis                                             | JDEMENATO                       | `jdemenato.cz/reservation/tenis-paradise/…`                         | refused (HTTP 403)                    | check on website              |
| ŽLTC Brno                         | tennis                                             | own (+ Auksys, login)           | `zltc.cz/reservations`                                              | unknown (JS)                          | check on website              |
| Tenisový areál Komárov            | tennis                                             | own                             | `tenis-komarov.cz/rozvrh/0`                                         | probably (styling only, not verified) | check on website              |
| Tenisová hala Kohoutovice         | tennis (4)                                         | Rezzy                           | `rezzy.eu/tennislinden/schedules`                                   | unknown (JS)                          | check on website              |
| TK Tesla Brno                     | tennis (8 outdoor)                                 | own (MRBS)                      | `teslabrno.cz/rezervace/`                                           | yes, but shows player names ³         | check on website              |
| Tenis Park Lužánky                | tennis (8 outdoor)                                 | phone / e-mail                  | –                                                                   | –                                     | check on website              |
| TJ Start Brno                     | tennis                                             | own (login)                     | `tjstartbrno.cz/online-rezervace/`                                  | unknown                               | check on website              |
| ZONE4YOU                          | squash (4)                                         | MemberZone (lessons)            | `memberzone.cz/zone4you/scheduler.aspx`                             | refused (HTTP 403)                    | check on website              |
| Squash Slovan                     | squash                                             | phone / SMS (iSportSystem view) | `squashslovan.isportsystem.cz`                                      | refused (HTTP 403)                    | check on website              |
| TJ Tesla – Sportovní hala Lesná   | volleyball (whole hall)                            | Reenio                          | `tjteslabrno.reenio.cz/…/sportovni-hala-r51584`                     | unknown (JS app)                      | check on website              |

¹ Viktoria's tennis court is a row of ClubSpire tab 3, but it is bookable in November with no
price or sport id, so its cells are not trusted. ² The PadelOS player app loads its API
(`api.padelos.co`) from a lazily loaded bundle we could not inspect in this run; recording the
browser's network requests is the next step. ³ Readable, but not used: the grid publishes
customers' names.

Not added (no usable data found): STAREZ Aréna Vodova and Hala Morenda (STAREZ system, but generic
halls, not offered per sport), Club Classic badminton, X-Arena / Squash Slovan / Kohoutovice table
tennis (listed as "other activities"), TJ Start's volleyball court.

### Live vs "check on website" per sport (in the venue data)

| Sport            | Venues | Live (connector)                                   | Check on website |
| ---------------- | -----: | -------------------------------------------------- | ---------------: |
| Badminton        |      7 | 7 (Bizzy ones `unavailable` when the host refuses) |                0 |
| Tennis           |     10 | 1 (Hala Sprint)                                    |                9 |
| Squash           |      5 | 3 (Viktoria, Fitness Boby, Ivanovice)              |                2 |
| Padel            |      4 | 1 (Viktoria)                                       |                3 |
| Table tennis     |      2 | 1 (Ivanovice)                                      |                1 |
| Volleyball       |      1 | 0                                                  |                1 |
| Beach volleyball |      4 | 2 (Beach Riviéra; Viktoria in season only)         |                2 |

### Why the connectors were chosen this way

By booking system, not by venue: the existing ClubSpire, MemberZone and MemberPro connectors
cover 6 new offerings with configuration only (a ClubSpire tab + court-name filter, a MemberZone
`ID_Sportoviste`, a MemberPro sport button). No other system covers more than one readable venue:
PadelOS covers 2 venues but is not inspectable yet, JDEMENATO / iSportSystem / Club Classic refuse
our requests, Reenio and Rezzy are JS apps with unknown APIs. STAREZ was the only new system that is
server-rendered and readable without login; it is Brno's municipal operator, so its other venues
can be added by data alone if they ever list sport courts.

## Badminton status (unchanged)

Every connector implements `AvailabilityConnector` (`backend/src/connectors/types.ts`) and is
registered in `createDefaultConnectors`; an offering goes from `unknown` to `live` once its
`source.type` has a registered connector. The Bizzy server often refuses data-centre IPs; then
those venues are `unavailable` ("check on website").

| Venues                                              | System                     | Public schedule page                                           | Status                                         |
| --------------------------------------------------- | -------------------------- | -------------------------------------------------------------- | ---------------------------------------------- |
| Kuklenská, Centrum Viktoria                         | ClubSpire                  | `timeline/day` (server-rendered HTML)                          | ✅ live                                        |
| Hala Sprint                                         | MemberZone                 | `memberzone.cz/sprint_tenis/Sportoviste.aspx?ID_Sportoviste=3` | ✅ live                                        |
| Sportcentrum Ivanovice                              | MemberPro (memberzone.cz)  | `memberzone.cz/ivanovice/`                                     | ✅ live                                        |
| Badminton Jehnice, Badminton Líšeň, X-Arena Slatina | Bizzy (`*.e-rezervace.cz`) | `/Branch/pages/Schedule.faces` (JSF page)                      | ✅ live (may refuse cloud IPs → `unavailable`) |

## MemberZone (Hala Sprint) – how it works

- `GET {url}` returns a **7-day week starting at the selected date** (default: today) as
  `table#tableLekce` with headers `th#DATUM1..7` ("STŘEDA 25.11."). Every **free** 60-minute
  window is a card `div[data-identifi="kurty"]` with hidden inputs `KurtyID` (free court ids),
  `KurtyName`, `DatumLekce2` ("25. 11. 2026"), `DelkaLekce` (60) and the time range
  `SkupCasOdDo` ("7:00 - 8:00"). Windows start every 30 minutes; booked courts are simply absent.
- The parser turns the cards of one date into 30-minute half-slots (a court is free in a
  half-slot when a card covering it lists the court), counts distinct courts and merges equal
  neighbours into `FreeSlot`s.
- **Date switch** (ASP.NET WebForms postback, verified live): POST the form back with all hidden
  inputs (`__VIEWSTATE`, `__VIEWSTATEGENERATOR`, …), the `ASP.NET_SessionId` cookie,
  `__EVENTTARGET=btnHidePom` (the hidden button the date picker's `change` handler clicks),
  `myDate=YYYY-MM-DD` and `DropDownDelka=60`. The response is the week starting at `myDate`. The
  page has no `__EVENTVALIDATION`.
- One page holds 7 days, so the connector keeps the other days of the week briefly, which saves
  requests when the calendar asks for a whole week or month.

## MemberPro (Sportcentrum Ivanovice) – how it works

- The schedule loads after picking a sport and a date. Both are a plain ASP.NET postback, so no
  headless browser is needed. `GET {url}` returns the form. One POST with all hidden inputs, the
  session cookie, `BTN5=Badminton` (the sport button) and the DevExpress date editor's value
  (`ASPxFormLayout2$Datepicker2=DD.MM.YYYY`, its `$State` JSON
  `{"rawValue":"<UTC-midnight ms>"}` and `DATUM_HF`) returns the server-rendered badminton grid
  for that date.
- Grid: one row per court (`tr[id*="RADEK_DAY_"]`, "Badminton 1..3"). Each 30-minute cell is an
  `<input type="submit">`: free = enabled `btnrez` with `title="7:00 25.11.2026 středa"`, taken
  or closed = `disabled` with `title="Blokováno"`. The parser checks that `DATUM_HF` and every
  free cell's date match the requested day, so it never returns another day's data.
- Hala Sprint and Ivanovice share the host `memberzone.cz`, so they share the per-host limiter
  and their requests are serialized.

## Bizzy (Jehnice, Líšeň, X-Arena) – recorded protocol

All three Bizzy subdomains (`badminton-jehnice`, `badmintonlisen`, `xarena` `.e-rezervace.cz`)
resolve to **185.58.41.50**. The server **refuses TCP connections from data-centre IPs**: the CI
runner and a second cloud fetcher got `ECONNREFUSED` on 2026-11-25. The same pages load fine from
a Czech residential connection, so the real pages were recorded there on 2026-11-25 and saved in
`backend/src/connectors/bizzy/fixtures/` (emails, phones and session ids replaced; bookings are
anonymised by Bizzy itself, `"blinded":true`, no names).

| Fixture                                 | What it is                                                          |
| --------------------------------------- | ------------------------------------------------------------------- |
| `<venue>-2026-11-25-today.html`         | `GET /Branch/pages/Schedule.faces` (venue's default view)           |
| `<venue>-2026-11-25-tomorrow-ajax.html` | A4J date-picker postback for 26.11.2026                             |
| `<venue>-2026-11-25-saturday-ajax.html` | A4J date-picker postback for 28.11.2026 (weekend hours)             |
| `<venue>-2026-11-25-week-ajax.html`     | A4J view switch to `horizontal_service_dayandweek` (8 days at once) |

Venues: `jehnice` (5 courts, default view is already "today + 7 days"), `lisen` and `xarena`
(default view "one day").

### Page structure

- `var scheduleData = {...}` (a JSON object inside a `<script>`) holds `grids` (one per shown
  day: `id`, `cols` = hourly columns, `rows` = courts, `closed`) and `events` (bookings:
  `gridId`, `start: [col, row]`, `end: [col, row]`, inclusive cell ranges; `blinded: true`).
  `pastTimeData` marks already-past cells per grid.
- Each grid is rendered as `table#schedule_<gridId>`: its header holds the date (`St 25/11`) and
  the hour labels of the columns (`7:00` … `21:00`; the number of columns differs per day),
  the row headers hold the court names (`Kurt 1` …).
- Free court-hours = all cells of a non-closed grid minus the cells covered by events.
  Confirm the `[col, row]` orientation against the table (cols = hours, rows = courts) and a
  multi-cell booking in the fixtures before relying on it.
- X-Arena only accepts bookings at least 2 h ahead, so cells starting sooner are not free.

### Date and view switching (verified live)

RichFaces 3 A4J postback: `POST /Branch/pages/Schedule.faces` with the `JSESSIONID` cookie from
the GET and the `scheduleNavigForm` fields:

- `AJAXREQUEST=scheduleNavigForm:schedule-navig-region` (the region id, **not** `_viewRoot`,
  otherwise the server ignores the action), `AJAX:EVENTS_COUNT=1`,
  `scheduleNavigForm=scheduleNavigForm`, `javax.faces.ViewState=<from the page>`, the hidden
  `scheduleNavigForm:j_idNNN` input with its value, `scheduleNavigForm:view_filter_menu=<view>`,
- `scheduleNavigForm:schedule_calendarInputDate=D.M.YYYY` and
  `scheduleNavigForm:schedule_calendarInputCurrentDate=M/YYYY`,
- plus the action parameter `<id>=<id>`: the date picker's `onchanged` component id for a date
  change, or the `view_filter_menu` `onchange` component id for a view change.

The `j_idNNN` ids **differ per venue** (date change is `j_id205` at Jehnice/Líšeň but `j_id209`
at X-Arena), so read them from the GET page (`'onchanged':function…'parameters':{'<id>'` and
the `select#scheduleNavigForm:view_filter_menu` `onchange`). The response is an XHTML fragment
that again contains `var scheduleData` and the tables. The chosen date and view are stored in
the session, so a following GET returns them too.

Best strategy: one GET + one view switch to `horizontal_service_dayandweek` gives 8 days per
venue; a date change on that view moves the 8-day window.

### Production reachability

Render's servers are data-centre IPs too, so the connector will most likely get
`ECONNREFUSED` in production as well. (On 2026-11-25 evening a later CI runner did reach the
server, so the block is not constant.) The connector treats that like any other failure
(`unavailable` → "check on website"); `AvailabilityService` logs **one warning per host per hour**
(with the number of suppressed failures) and backs the host off for 5 → 60 min after a
connection-level failure (refused, reset, DNS, timeout), so neither user requests nor the cache
warmer keep hammering it. Making it work reliably in production needs the operator's cooperation
(ask Bizzy / the venues to allow it or provide a feed). Routing around the block through
residential proxies is not an option.

### Implementation notes (verified on all 12 fixtures)

- `[col, row]` = `[time column, court]`, both ends inclusive, an event is a rectangle (e.g. Líšeň
  Saturday `[24,0]–[27,5]` books all 6 courts 20:00–22:00). Cell ids `sched_<grid>_i_<row>_<col>`
  confirm the orientation.
- Column length differs per venue: Líšeň uses **30-minute** columns, Jehnice and X-Arena hourly;
  the step comes from the header labels.
- `pastTimeData[grid][row]` is the index of the last already-started column (-1 = none); those
  cells are never free.
- Headers have no year (`So 28/11`); it is inferred from `schedule_calendarInputDate` (or the
  requested date), handling Dec → Jan, and the Czech weekday must match.
- X-Arena's 2-hour lead time is configured as `minLeadMinutes: 120` on its source and applied at
  read time (not when caching).
- Stub mode (E2E) serves the recorded pages with dates rewritten; every stubbed day is a copy of
  the recorded Thursday 26.11 grid.

## Recipe per system (same for every connector)

1. Record 2–3 real pages: today, a busy evening and a closed day, plus the GET → POST round trip
   that switches the date (hidden `ViewState` / `__VIEWSTATE` fields and cookies). Strip personal
   names, phone numbers and emails, then save them as fixtures in
   `backend/src/connectors/<system>/fixtures/`.
2. Write `parser.ts`, a pure HTML → `FreeSlot[]` function (courts aggregated per time interval),
   and make it throw a `<System>ParseError` when the expected structure is missing, never
   returning partial data. Add a `parser.test.ts` that runs against the fixtures.
3. Write `connector.ts` (fetch + date navigation) with the politeness rules: `User-Agent:
SpotRadar/1.0`, 8 s timeout, the shared per-host limiter, and the 15-minute cache in
   `AvailabilityService`. Add a `connector.test.ts` with an injected `fetch` (success, date
   switch, HTTP error, timeout, changed markup).
4. Register the connector in `createDefaultConnectors` and in the E2E stub fetch
   (`backend/src/stubs.ts`), then update the README status table.

Venues without live data are shown as **"check on website"** in the calendar's slot panel, with a
direct link to the venue's booking page. A free court is never guessed. Offerings with unknown
opening hours count as possibly open 07:00–22:00 (`UNKNOWN_HOURS_WINDOW`) for that "check" state
only; the hours themselves are shown as "Opening hours unknown".

## Seasons

`OpeningHours.season` ("MM-DD" from/to, may wrap the year end) marks seasonal outdoor offerings
(Viktoria beach 05-01..09-30, Kraví hora beach 05-01..10-31). Out of season the backend does not read
the booking system at all (Viktoria's ClubSpire lists the sand courts as bookable all year), the
calendar shows the offering as closed and the venue list says "Closed out of season".

## Per-sport sources on the existing systems (recorded 2026-11-25/26)

- **ClubSpire**: one timeline tab per sport (`tabIdx`). Viktoria: 0 squash (6 courts, 30-min
  cells), 1 badminton, 2 beach (5), 3 "PADEL 1-3 + Venkovní kurty" (15-min cells), 4 bowling.
  Tab 3 mixes padel with a tennis court and a multi-purpose court, so the source has
  `courtNamePrefixes: ['Padel']`: the parser keeps only rows whose name in
  `#activities_halls li.hall#<data-row-id>` starts with a prefix (case-insensitive) and throws when
  the filter is set but no names are found. Fitness Boby runs its own ClubSpire on port 28080,
  squash is tab 4. Fixtures: `clubspire/fixtures/viktoria-{squash,beach-volleyball,padel-tennis}-2026-11-26.html`,
  `fitnessboby-squash-2026-11-26.html` (unchanged real pages; large because of tooltip markup).
- **MemberZone**: Hala Sprint's indoor tennis is `ID_Sportoviste=1` (6 courts; the outdoor courts
  `=2` are summer only). Fixture `memberzone/fixtures/sprint-tennis-2026-11-25.html` (GET, week from
  25.11.).
- **MemberPro**: the sport is the posted button, now `source.sportButton` (Ivanovice: `BTN5=Badminton`,
  `BTN4=Squash`, `BTN3=Ping-pong`). The connector keeps one session per page + sport, so a reused
  form state never mixes sports. Fixtures `memberpro/fixtures/ivanovice-{squash,table-tennis}-2026-11-26.html`.

## STAREZ (Beach Riviéra) – recorded protocol

STAREZ-SPORT is Brno's municipal sports company; its venues run one reservation system at
`https://<venue>.starez.cz/vstupenky-rezervace` (Nette + naja). Verified with curl on 2026-11-25:

- `GET {url}` returns today's page and a session cookie. `div.reservation[data-active-date]` holds
  the shown date. Each facility is a `.facility--grouped` with `h4.facility-group__title`
  ("Beachvolejbal"; the source's `facility` selects it), one `.facility-group__unit-row` per court
  ("kurt 1"…6) and one `div.block` per cell with `<span class="block-time">15:00-16:00</span>`
  (`data-slot-minutes` 60 here; multiples of 30 are supported).
- Free = `data-reservation-name="volno k rezervaci"` ("free to book with deposit", green, "0/1").
  Booked cells carry the customer's name; grey cells without a reservation are not available.
- Another day: `GET {url}?date=DD.MM.YYYY&do=getDate` with `X-Requested-With: XMLHttpRequest` and
  the session cookie returns JSON `{"snippets":{"snippet--reservation":"<html>"}}`. Without the XHR
  header the server stores the date in the session and answers a redirect. The parser always checks
  that `data-active-date` is the requested day.
- The connector (`backend/src/connectors/starez/`) reuses the session for 5 minutes, falls back to
  a clean GET when a reused session answers anything unexpected, and uses the shared host limiter,
  8 s timeout and `User-Agent: SpotRadar/1.0`.
- Fixtures `starez/fixtures/beach-2026-11-25-today.html`, `beach-2026-11-2{6,8}-ajax.json`: real
  answers; customer surnames replaced with "Rezervováno" (club names kept). In E2E stub mode every
  day shows the recorded 25.11. grid.
- STAREZ Aréna Vodova and Hala Morenda use the same system but list generic halls/gyms
  ("tělocvična", "celý sál"), not sport courts, so they are not in the data.

## Next steps (not done in this change)

- **PadelOS** (Padel Powers Slatina + Kraví hora, 14 courts): record the player app's network
  requests in a browser (company 217, clubs 216930 / 216928) and check whether free slots are
  readable without login; then it is the best next connector.
- MultiSport terms "1 card = 1/4 of the price" (Club Classic, Tenis Paradise, Padel Club Brno) do
  not fit the current categories and are stored as `unknown` with a note; a `quarter-per-card`
  category would let the price calculation use them.
- Prague: add venue records with the existing source types (ClubSpire, MemberZone/MemberPro, Bizzy,
  STAREZ-like systems); no connector code is Brno-specific.
