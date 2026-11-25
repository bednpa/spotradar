# Live availability for all Brno badminton venues – connector plan

Status (2026-11-25): **4 of 7 venues are live** – two on **ClubSpire**, Hala Sprint on
**MemberZone** and Sportcentrum Ivanovice on **MemberPro**. The three **Bizzy** venues are still
`unknown` ("check on website"): their server blocks data-centre IPs, but real pages and the
date-switch protocol are now recorded (see below), so the connector can be built. Every connector implements `AvailabilityConnector`
(`backend/src/connectors/types.ts`) and is registered in `createDefaultConnectors`; a venue goes
from `unknown` to `live` once its `source.type` has a registered connector.

| Venues                                              | System                     | Public schedule page                                           | Status                                          |
| --------------------------------------------------- | -------------------------- | -------------------------------------------------------------- | ----------------------------------------------- |
| Kuklenská, Centrum Viktoria                         | ClubSpire                  | `timeline/day` (server-rendered HTML)                          | ✅ live                                         |
| Hala Sprint                                         | MemberZone                 | `memberzone.cz/sprint_tenis/Sportoviste.aspx?ID_Sportoviste=3` | ✅ live                                         |
| Sportcentrum Ivanovice                              | MemberPro (memberzone.cz)  | `memberzone.cz/ivanovice/`                                     | ✅ live                                         |
| Badminton Jehnice, Badminton Líšeň, X-Arena Slatina | Bizzy (`*.e-rezervace.cz`) | `/Branch/pages/Schedule.faces` (JSF page)                      | ⏳ recorded, connector to do (blocks cloud IPs) |

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
`ECONNREFUSED` in production as well. The connector must treat that like any other failure
(`unavailable` → "check on website"), and the backend should log one clear warning instead of
one per request. Making it work in production needs the operator's cooperation (ask Bizzy /
the venues to allow it or provide a feed). Routing around the block through residential proxies
is not an option.

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
direct link to the venue's booking page. A free court is never guessed.
