# Live availability for all Brno badminton venues – connector plan

Status (2026-11-25): 2 of 7 venues are live (both run **ClubSpire**). The other 5 use three
other booking systems whose public schedules can be viewed without logging in, so each one
can get a connector behind the existing `AvailabilityConnector` interface
(`backend/src/connectors/types.ts`). No other part of the app needs to change: a venue goes from
`unknown` to `live` once its `source.type` has a registered connector in `createDefaultConnectors`.

| Venues                                              | System                     | Public schedule page                                                                                      | Plan                                        |
| --------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Kuklenská, Centrum Viktoria                         | ClubSpire                  | `timeline/day` (server-rendered HTML)                                                                     | ✅ done                                     |
| Badminton Jehnice, Badminton Líšeň, X-Arena Slatina | Bizzy (`*.e-rezervace.cz`) | `/Branch/pages/Schedule.faces` (JSF page – day switching probably a form POST, to be confirmed)           | one connector → **+3 venues (5/7)**         |
| Hala Sprint                                         | MemberZone                 | `memberzone.cz/sprint_tenis/Sportoviste.aspx?ID_Sportoviste=3` (`.aspx` page – structure to be confirmed) | one connector → **+1 venue (6/7)**          |
| Sportcentrum Ivanovice                              | MemberPro (memberzone.cz)  | `memberzone.cz/ivanovice/`                                                                                | possibly shares MemberZone's grid → **7/7** |

Bizzy gives the biggest win (three venues, one parser), so it comes first.

## Why these connectors are not in this change

The agent run that did the calendar redesign was in a sandbox with no outbound HTTP, so it
could not record the real Bizzy and MemberZone pages. A parser written without the real markup
would be guesswork. It might pass its own invented fixtures and then report wrong free courts
in production, which is worse than an honest "check on website". The connectors therefore need
one session **with network access** to record real pages first.

## Recipe per system (same as the ClubSpire connector)

1. Record 2–3 real pages: today, a busy evening and a closed day. For JSF and ASP.NET pages also
   record the GET → POST round trip that switches the date (hidden `ViewState` / `__VIEWSTATE`
   - `__EVENTVALIDATION` fields and cookies). Strip personal names and phone numbers from cells,
     then save them as fixtures in `backend/src/connectors/<system>/fixtures/`.
2. Write `parser.ts`, a pure HTML → `FreeSlot[]` function (courts aggregated per time interval),
   and make it throw a `<System>ParseError` when the expected grid is missing, never returning
   partial data. Add a `parser.test.ts` that runs against the fixtures.
3. Write `connector.ts` (fetch + date navigation) with the existing politeness rules: `User-Agent:
SpotRadar/1.0`, 8 s timeout, the shared per-host limiter (Jehnice, Líšeň and X-Arena are
   different hosts; Sprint and Ivanovice share `memberzone.cz`, so they are serialized), and the
   15-minute cache in `AvailabilityService`. Add a `connector.test.ts` with an injected `fetch`.
4. Register the connector in `createDefaultConnectors` and in the E2E stub fetch
   (`backend/src/stubs.ts`), then flip the README status table.

Until then the new calendar shows those venues as **"check on website"** (amber) during their
opening hours, with a direct link to the venue's booking page. A free court is never guessed.
