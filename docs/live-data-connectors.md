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

| Venue                             | Sports in SpotRadar                                | Booking system               | Public schedule                                                      | Free slots w/o login                                  | In SpotRadar                  |
| --------------------------------- | -------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------- |
| Centrum Viktoria                  | badminton, squash, padel, beach volleyball, tennis | ClubSpire                    | `rezervace.centrumviktoria.cz:18443/timeline/day?tabIdx=`            | yes (tabs 0 squash, 1, 2 beach, 3)                    | live; tennis "check" ¹        |
| Sportcentrum Kuklenská            | badminton                                          | ClubSpire                    | `kuklenska.clubspire.cz/timeline/day?tabIdx=0`                       | yes                                                   | live                          |
| Fitness Boby                      | squash                                             | ClubSpire                    | `rezervace.fitnessboby.cz:28080/timeline/day?tabIdx=4`               | yes                                                   | live                          |
| Hala Sprint                       | badminton, tennis (6 indoor)                       | MemberZone                   | `memberzone.cz/sprint_tenis/Sportoviste.aspx?ID_Sportoviste=3 / =1`  | yes                                                   | live                          |
| Sportcentrum Ivanovice            | badminton, squash, table tennis                    | MemberPro                    | `memberzone.cz/ivanovice/` (BTN5 / BTN4 / BTN3)                      | yes                                                   | live                          |
| Badminton Jehnice, Líšeň, X-Arena | badminton                                          | Bizzy                        | `*.e-rezervace.cz/Branch/pages/Schedule.faces`                       | yes, but refuses data-centre IPs                      | live / `unavailable`          |
| Beach Riviéra (STAREZ)            | beach volleyball (6, heated hall in winter)        | STAREZ (own, `*.starez.cz`)  | `beach.starez.cz/vstupenky-rezervace`                                | yes (server-rendered)                                 | live (**new connector**)      |
|                                   | Padel Powers Slatina                               | padel (10 indoor)            | PadelOS                                                              | `api.padelos.co/customers/searchByDate` (club 216930) | yes (JSON, no login)          | live (**new**, 2026-11-26) |
| Padel Powers Kraví hora           | padel (4 outdoor)                                  | PadelOS                      | `api.padelos.co/customers/searchByDate` (club 216928)                | yes (no slots offered in winter)                      | live (**new**)                |
| Padel Club Brno                   | padel (4, closed in winter)                        | own                          | `padelclub.cz/rezervace`                                             | no (script + login)                                   | check on website              |
| Club Classic                      | tennis (10), beach volleyball (4), table tennis    | unknown                      | `rezervace.clubclassic.cz`                                           | no: HTTP 403 "no index" page (nothing deployed) ⁴     | check on website              |
| Kraví hora beach                  | beach volleyball (2, May–Oct)                      | own client zone (Wardeneta)  | `zakaznik.kravihora-brno.cz/kzona`                                   | no: API answers 401 `MISSING_TOKEN` ⁵                 | check on website (closed now) |
| Tenis Paradise                    | tennis                                             | JDEMENATO                    | `jdemenato.cz/reservation/tenis-paradise/…`                          | refused (HTTP 403, Cloudflare challenge) ⁴            | check on website              |
| ŽLTC Brno                         | tennis                                             | own (SvelteKit + Firestore)  | Firestore project `zltc-prod-c9e6c` (`courts`, `config`, `runQuery`) | yes (public read; names never fetched)                | live (**new**)                |
| Tenisový areál Komárov            | tennis                                             | own                          | `tenis-komarov.cz/rozvrh/<week offset>/`                             | yes (server-rendered)                                 | live (**new**)                |
| Tenisová hala Kohoutovice         | tennis (4)                                         | Rezzy                        | `rezzy.eu/api/…/CustomerSchedules/ReservationBlockers`               | yes (anonymous busy times)                            | live (**new**)                |
| TK Tesla Brno                     | tennis (8 outdoor)                                 | own (MRBS)                   | `teslabrno.cz/rezervace/index.php?view=day&page_date=`               | yes, but shows player names ³                         | check on website              |
| Tenis Park Lužánky                | tennis (8 outdoor)                                 | phone / e-mail               | –                                                                    | –                                                     | check on website              |
| TJ Start Brno                     | tennis                                             | own (login)                  | `tjstartbrno.cz/online-rezervace/`                                   | unknown                                               | check on website              |
| ZONE4YOU                          | squash (4)                                         | EMA (DevExpress scheduler)   | `memberzone.cz/zone4you/scheduler.aspx`                              | page loads now (200), but a different app ⁶           | check on website              |
| Squash Slovan                     | squash (3)                                         | iSportSystem (phone booking) | `squashslovan.isportsystem.cz/ajax/ajax.schema.php`                  | yes (200 now) ⁴                                       | live (**new**)                |
| TJ Tesla – Sportovní hala Lesná   | volleyball (whole hall)                            | Reenio                       | `tjteslabrno.reenio.cz/cs/api/Term/List` (resource 51584)            | yes (JSON, no login)                                  | live (**new**)                |

¹ Viktoria's tennis court is a row of ClubSpire tab 3 ("Tenis", group "PADEL 1-3 + Venkovní
kurty"). Re-checked on 2026-11-26 for 26.11.–1.12.: every cell is bookable, Friday and Saturday
evenings included, with `sportId/null`, no lesson name and no price, while the padel rows carry a
sport id and "200 Kč /15 min.". The website describes it as an outdoor court (outdoor changing
rooms, lighting surcharge), so the cells are not trusted and tennis stays "check on website"; in
season the prefix would be `Tenis`. ³ Readable, but not used: the grid publishes customers'
names, has no "closed" state (every cell of the outdoor clay courts is `new` in November, after the
season ended in October) and the season dates are not published, so a free cell would not mean an
open court. ⁴ Re-checked 2026-11-26 with plain `User-Agent: SpotRadar/1.0` requests. ⁵ The public
`/plazovy-volejbal/rozpis?from=` table on `kravihora-brno.cz` is readable, but its summer 2026
beach weeks show only free cells (client-zone bookings do not appear), so it cannot be trusted;
re-check in the 2027 season. ⁶ `Sportoviste.aspx` answers 404 there; squash is a DevExpress
ASPxScheduler resource behind a ViewState postback, so the MemberZone connector does not fit.

Not added (no usable data found): STAREZ Aréna Vodova and Hala Morenda (STAREZ system, but generic
halls, not offered per sport), Club Classic badminton, X-Arena / Squash Slovan / Kohoutovice table
tennis (listed as "other activities"), TJ Start's volleyball court.

### Live vs "check on website" per sport (in the venue data)

| Sport            | Venues | Live before (2026-11-25)              | Live now (2026-11-26)                  | Check on website now |
| ---------------- | -----: | ------------------------------------- | -------------------------------------- | -------------------: |
| Badminton        |      7 | 7 (Bizzy `unavailable` if refused)    | 7 (unchanged)                          |                    0 |
| Tennis           |     10 | 1 (Hala Sprint)                       | 4 (+ Kohoutovice, Komárov, ŽLTC)       |                    6 |
| Squash           |      5 | 3 (Viktoria, Fitness Boby, Ivanovice) | 4 (+ Squash Slovan)                    |                    1 |
| Padel            |      4 | 1 (Viktoria)                          | 3 (+ Padel Powers Slatina, Kraví hora) |                    1 |
| Table tennis     |      2 | 1 (Ivanovice)                         | 1                                      |                    1 |
| Volleyball       |      1 | 0                                     | 1 (+ TJ Tesla Lesná)                   |                    0 |
| Beach volleyball |      4 | 2 (Beach Riviéra; Viktoria in season) | 2                                      |                    2 |

### Why the connectors were chosen this way

By booking system, not by venue: the existing ClubSpire, MemberZone and MemberPro connectors
cover 6 offerings with configuration only. On 2026-11-26 the JS apps were inspected by reading
their bundles: PadelOS, Reenio and Rezzy all have anonymous JSON endpoints, so each got a generic
connector whose source holds only ids (Prague venues on the same systems need data only).
iSportSystem answered 200 this time. Komárov and ŽLTC run their own systems, so their connectors
are venue-specific (`bookingSystem: 'own'`). STAREZ is Brno's municipal operator, so its other
venues can be added by data alone if they ever list sport courts. |

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

## PadelOS, Reenio, Rezzy, iSportSystem (recorded 2026-11-26)

All four were found by reading the apps' JS bundles and reproduced with plain `curl -A
'SpotRadar/1.0'` (no cookies, tokens or logins). Each connector lives in
`backend/src/connectors/<system>/` with `parser.ts`, `connector.ts`, `stub.ts` (E2E) and tests;
the PadelOS fixtures are produced by `backend/scripts/sanitize-padelos-fixtures.ts`.

- **PadelOS** (Padel Powers): `POST https://api.padelos.co/customers/searchByDate`, header
  `x-clubos-club: <clubId>` (HTTP 400 without it), JSON body `{"date":"YYYY-MM-DD","sport":"padel",…}`.
  `data[0].availability[]` holds one group per duration (60/90/120) with `slots[]`
  `{date, startTime, endTime, courts[]}`; only bookable offers are listed (no booked cells, no
  personal data), times are club-local. The server hides offers that would leave gaps < 60 min,
  so the parser unions all duration groups per court before counting courts per 30 minutes. Past
  start times of today are already omitted. The club id in the answer and every slot date are
  checked. Kraví hora (outdoor) offers nothing in winter → live, empty. Booking horizon: Slatina
  4 days, Kraví hora 15. Fixtures keep only `id`, `name`, timezone, policies and `availability`
  (the large `company` block with terms and contacts is dropped).
- **Reenio** (TJ Tesla hall): `POST {baseUrl}/api/Term/List` as **multipart** form data with
  `date` and `filter.pseudoTerm.resourceIds[0]` (a JSON body is answered but the filter ignored, so
  the parser checks every event's resource id). `data.events[]` are the bookable windows (UTC ISO
  times, converted to Prague time), each with `reservationIntervalSize` (grid), `def.minLength`,
  `reservations[]` and `collisions` (bookings of other resources of the same service, e.g. a
  badminton court blocks the whole hall); free = window − reservations − collisions, on the grid,
  ≥ `minLength`, and not sooner than `reservationDueDate` (2 h) from now. No personal data.
- **Rezzy** (Kohoutovice): `GET https://www.rezzy.eu/api/sportarea/v1/Tenants/{tenantId}/SportAreas/{sportAreaId}?date=`
  gives the courts in display order, the season hours per weekday, the 30-minute grid and the
  60-minute minimum (cached 1 h); `GET …/reservation/v1/Tenants/{t}/SportAreas/{a}/CustomerSchedules/ReservationBlockers?date=`
  gives anonymous busy blocks `{playfieldIdFrom, playfieldIdTo, from, to}` (an inclusive span in
  display order). Free = hours − blocks per court, runs ≥ 60 min, started cells of today dropped.
  The endpoints listing individual reservations answer 401 and are not used.
- **iSportSystem** (Squash Slovan): `POST {baseUrl}/ajax/ajax.schema.php` with
  `id_sport=1&day=&month=&year=&event=pageLoad&timetableWidth=970` returns ~4 days, one
  `div.schemaFullContainer` per day ("Čtvrtek 26.11.", year inferred, weekday checked), 30-minute
  cells with a `title` "15:00–15:30 - Obsazeno". Free = `tdNoBooking` ("Rezervace pouze
  telefonicky": not taken, booked by phone, which is how the club takes bookings) or `empty`;
  `booked`, `old` and "Technická přestávka" are not free. The answer is kept 60 s for its other
  days. Weekends list only the booked hours (the club opens on demand).

## Komárov and ŽLTC (own systems, recorded 2026-11-26)

- **Tenisový areál Komárov**: `GET https://www.tenis-komarov.cz/rozvrh/<N>/` (trailing slash,
  otherwise 301) shows the Monday–Sunday week `N` weeks from now (negative N = this week, so no
  history). `section#rezervacni-system table.timetable`: one block per day
  (`th.timetable-day` "Čt<br>26.11.2026", rowspan = courts), one row per court, hourly columns
  07:00–22:00 with four 15-minute `<div>`s each. `free` / `discount` = free, `mass` / `single` =
  booked, `closed` = closed. A court counts as free for a half hour when both quarters are free.
  Past cells keep their colour, so started half hours of today are dropped. One request per week
  (cached 2 min). No personal data; fixtures are trimmed by `backend/scripts/sanitize-komarov-fixtures.ts`.
- **ŽLTC Brno**: the club's SvelteKit app reads Firebase project `zltc-prod-c9e6c` through the
  public Firestore REST API (`firestore.googleapis.com`, no login or key). `documents/courts`
  (winter: Pevná hala, Nafukovací hala 1 + 2; summer: clay courts) and `documents/config/reservations`
  (48 half-hour segments per day, open/close segment, `is_summer`, `reservations_enabled`,
  `last_allowed_reservation_date`) are cached 1 h; bookings come from `documents:runQuery` with
  `dates ARRAY_CONTAINS <Prague midnight as UTC timestamp>`. The booking documents also hold
  customers' names and user ids, so the query **always** has a field projection (`select` of
  `dates` and `reservations` only): names are never downloaded, logged or stored (a test checks the
  request body; the E2E stub rejects a query without the projection). Free = season courts × open
  segments − booked segments. Caveat: the config has one closing segment (21:00) for every day,
  while the website says weekends close at 20:00, so a weekend 20:00–21:00 may show as free.
  Fixtures are produced by `backend/scripts/sanitize-zltc-fixtures.ts`, which fails unless each
  document has only `dates` and `court_id` / `segment_idxs`.

## Next steps (not done in this change)

- ZONE4YOU (EMA / DevExpress scheduler), TK Tesla (once a season or closed state is published)
  and Kraví hora beach (re-check the public `rozpis` table in the 2027 season) are the remaining
  readable candidates; JDEMENATO (Cloudflare challenge), Club Classic (no page), Padel Club Brno
  and TJ Start (login) are blocked.
- MultiSport terms "1 card = 1/4 of the price" (Club Classic, Tenis Paradise, Padel Club Brno) do
  not fit the current categories and are stored as `unknown` with a note; a `quarter-per-card`
  category would let the price calculation use them.
- Prague: add venue records with the existing source types (ClubSpire, MemberZone/MemberPro, Bizzy,
  STAREZ-like systems, PadelOS, Reenio, Rezzy, iSportSystem); no connector code is Brno-specific
  (only the Komárov and ŽLTC connectors are venue-specific).
