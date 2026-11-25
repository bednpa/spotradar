# Live availability for all Brno badminton venues – connector plan

Status (2026-11-25): **4 of 7 venues are live** – two on **ClubSpire**, Hala Sprint on
**MemberZone** and Sportcentrum Ivanovice on **MemberPro**. The three **Bizzy** venues are still
`unknown` ("check on website") because their booking server could not be reached when the
connectors were built (see below). Every connector implements `AvailabilityConnector`
(`backend/src/connectors/types.ts`) and is registered in `createDefaultConnectors`; a venue goes
from `unknown` to `live` once its `source.type` has a registered connector.

| Venues                                              | System                     | Public schedule page                                           | Status                                     |
| --------------------------------------------------- | -------------------------- | -------------------------------------------------------------- | ------------------------------------------ |
| Kuklenská, Centrum Viktoria                         | ClubSpire                  | `timeline/day` (server-rendered HTML)                          | ✅ live                                    |
| Hala Sprint                                         | MemberZone                 | `memberzone.cz/sprint_tenis/Sportoviste.aspx?ID_Sportoviste=3` | ✅ live                                    |
| Sportcentrum Ivanovice                              | MemberPro (memberzone.cz)  | `memberzone.cz/ivanovice/`                                     | ✅ live                                    |
| Badminton Jehnice, Badminton Líšeň, X-Arena Slatina | Bizzy (`*.e-rezervace.cz`) | `/Branch/pages/Schedule.faces` (JSF page)                      | ⛔ blocked – server unreachable, see below |

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

## Bizzy (Jehnice, Líšeň, X-Arena) – what blocked it

All three Bizzy subdomains (`badminton-jehnice`, `badmintonlisen`, `xarena` `.e-rezervace.cz`)
resolve to **185.58.41.50**. When the connectors were built (2026-11-25), that address actively
**refused TCP connections on ports 80 and 443** (`ECONNREFUSED`). This happened both from the CI
runner and from a second, independent fetcher, while every other host (memberzone.cz, ClubSpire,
`www.e-rezervace.cz` on a different IP) worked. The server is probably firewalled against
data-centre IP ranges. The only copy of the page available was a Wayback Machine snapshot from
March 2025. It shows the JSF form and `javax.faces.ViewState`, but it cannot be used to confirm
the current markup, the date-switch request or any real availability.

A parser written without a current recording would be guesswork. So, under the "no invented
fixtures" rule, Bizzy has **no connector** and those venues keep showing "check on website" with
a direct link. Before building it, also check that the production host (Render) can reach
185.58.41.50 at all: if Bizzy blocks cloud IPs, a connector would only ever report `unavailable`.

Next steps for Bizzy (needs a network that can reach the server):

1. Record `GET /Branch/pages/Schedule.faces` (keep `JSESSIONID` + `javax.faces.ViewState`) for
   today, a busy evening and a closed day. Find the embedded booking JSON
   (`"events":[{"start":[..],"end":[..],"gridId":..}]`) and the court grid definition.
2. Find the "next day" / date-picker request in the page's form and JS (JSF/RichFaces A4J
   postback), and confirm that it returns a different day's events.
3. Free slots = opening hours × courts minus events. X-Arena only accepts bookings at least 2 h
   ahead, so slots starting sooner must not count as free.

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
