import type { FreeSlot } from '@spotradar/shared';
import { isValidDate, zonedMidnightEpochMs } from '@spotradar/shared';
import type { LocalDateTime } from '@spotradar/shared';
import { HALF_SLOT_MINUTES, freeSlotsFromHalfSlots } from '../halfSlots.ts';

/** Thrown when a Firestore answer does not have the expected shape (collection layout changed). */
export class ZltcParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZltcParseError';
  }
}

/** Thrown when Firestore answers with an error object (e.g. PERMISSION_DENIED after locking the rules). */
export class ZltcApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZltcApiError';
  }
}

/** A court document (`courts/<id>`). */
export interface ZltcCourt {
  id: string;
  name: string;
  winter: boolean;
  summer: boolean;
}

/** The parts of `config/reservations` the connector needs. */
export interface ZltcConfig {
  isSummer: boolean;
  reservationsEnabled: boolean;
  /** Last bookable day "YYYY-MM-DD" (inclusive); undefined = no limit. */
  lastAllowedDate: string | undefined;
  /** First and last bookable 30-minute segment of the current season (inclusive). */
  openIdx: number;
  closeIdx: number;
}

/** Booked segments per court id on one day. */
export type ZltcBookings = Map<string, Set<number>>;

/** Segments per day: `idx * 30` minutes after local midnight. */
export const SEGMENTS_PER_DAY = 48;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function failIfError(json: unknown): void {
  const error = isObject(json) ? json.error : undefined;
  if (isObject(error)) {
    const status = typeof error.status === 'string' ? error.status : 'error';
    const message = typeof error.message === 'string' ? `: ${error.message}` : '';
    throw new ZltcApiError(`ŽLTC Firestore answered ${status}${message}`);
  }
}

/** The typed value of a Firestore field, e.g. `{ stringValue: "x" }` → "x". */
function typed(fields: Json, name: string, kind: string, what: string): unknown {
  const wrapper = fields[name];
  if (!isObject(wrapper) || !(kind in wrapper)) {
    throw new ZltcParseError(`ŽLTC ${what} has no ${kind} field "${name}"`);
  }
  return wrapper[kind];
}

function fieldsOf(doc: unknown, what: string): Json {
  if (!isObject(doc) || !isObject(doc.fields))
    throw new ZltcParseError(`ŽLTC ${what} has no fields`);
  return doc.fields;
}

function boolField(fields: Json, name: string, what: string): boolean {
  const value = typed(fields, name, 'booleanValue', what);
  if (typeof value !== 'boolean')
    throw new ZltcParseError(`ŽLTC ${what} "${name}" is not a boolean`);
  return value;
}

function stringField(fields: Json, name: string, what: string): string {
  const value = typed(fields, name, 'stringValue', what);
  if (typeof value !== 'string') throw new ZltcParseError(`ŽLTC ${what} "${name}" is not a string`);
  return value;
}

/** Firestore sends integers as decimal strings. */
function toInteger(value: unknown, what: string): number {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n)) {
    throw new ZltcParseError(`ŽLTC ${what} is not an integer`);
  }
  return n;
}

function segmentIdxField(fields: Json, name: string, what: string): number {
  const idx = toInteger(typed(fields, name, 'integerValue', what), `${what} "${name}"`);
  if (idx < 0 || idx >= SEGMENTS_PER_DAY)
    throw new ZltcParseError(`ŽLTC ${what} "${name}" is out of range`);
  return idx;
}

/** Values of a Firestore `arrayValue` (an empty array has no `values`). */
function arrayValues(fields: Json, name: string, what: string): unknown[] {
  const array = typed(fields, name, 'arrayValue', what);
  if (!isObject(array)) throw new ZltcParseError(`ŽLTC ${what} "${name}" is not an array`);
  if (array.values === undefined) return [];
  if (!Array.isArray(array.values))
    throw new ZltcParseError(`ŽLTC ${what} "${name}" is not an array`);
  return array.values as unknown[];
}

/** `courts` collection list (`GET …/documents/courts`). */
export function parseZltcCourts(json: unknown): ZltcCourt[] {
  failIfError(json);
  if (!isObject(json)) throw new ZltcParseError('ŽLTC courts answer is not an object');
  if (json.nextPageToken !== undefined)
    throw new ZltcParseError('ŽLTC has more courts than one page');
  const documents = json.documents ?? [];
  if (!Array.isArray(documents))
    throw new ZltcParseError('ŽLTC courts answer has no document list');
  return documents.map((doc: unknown) => {
    const path = isObject(doc) && typeof doc.name === 'string' ? doc.name : '';
    const id = path.split('/').pop() ?? '';
    if (id === '') throw new ZltcParseError('ŽLTC court has no document name');
    const fields = fieldsOf(doc, 'court');
    return {
      id,
      name: stringField(fields, 'name', 'court'),
      winter: boolField(fields, 'is_winter', 'court'),
      summer: boolField(fields, 'is_summer', 'court'),
    };
  });
}

/** `config/reservations` document (`GET …/documents/config/reservations`). */
export function parseZltcConfig(json: unknown): ZltcConfig {
  failIfError(json);
  const fields = fieldsOf(json, 'config');
  const isSummer = boolField(fields, 'is_summer', 'config');
  const season = isSummer ? 'summer' : 'winter';
  const openIdx = segmentIdxField(fields, `${season}_open_idx`, 'config');
  const closeIdx = segmentIdxField(fields, `${season}_close_idx`, 'config');
  if (openIdx > closeIdx) throw new ZltcParseError('ŽLTC config opens after it closes');
  let lastAllowedDate: string | undefined;
  if (fields.last_allowed_reservation_date !== undefined) {
    lastAllowedDate = stringField(fields, 'last_allowed_reservation_date', 'config');
    if (!isValidDate(lastAllowedDate)) {
      throw new ZltcParseError('ŽLTC config has an invalid last_allowed_reservation_date');
    }
  }
  return {
    isSummer,
    reservationsEnabled: boolField(fields, 'reservations_enabled', 'config'),
    lastAllowedDate,
    openIdx,
    closeIdx,
  };
}

/** True when the club takes reservations for `date` at all (enabled and not after the last day). */
export function isBookableDate(config: ZltcConfig, date: string): boolean {
  if (!config.reservationsEnabled) return false;
  return config.lastAllowedDate === undefined || date <= config.lastAllowedDate;
}

/** The courts of the current season (`is_winter` / `is_summer` matching `config.is_summer`). */
export function seasonCourts(courts: readonly ZltcCourt[], config: ZltcConfig): ZltcCourt[] {
  const result = courts.filter((court) => (config.isSummer ? court.summer : court.winter));
  if (result.length === 0) throw new ZltcParseError('ŽLTC has no courts for the current season');
  return result;
}

/** Local midnight of `date` as the UTC timestamp Firestore stores ("2026-11-25T23:00:00Z"). */
export function zltcDayTimestamp(date: string): string {
  return new Date(zonedMidnightEpochMs(date)).toISOString().replace('.000Z', 'Z');
}

/**
 * Body of `POST …/documents:runQuery`: reservations whose `dates` contain the local midnight of
 * `date` (what the club's own app asks). The `select` projection limits the answer to `dates`
 * and `reservations` (court + segments), so customer names and user ids are never downloaded.
 */
export function buildZltcQuery(date: string): unknown {
  return {
    structuredQuery: {
      select: { fields: [{ fieldPath: 'dates' }, { fieldPath: 'reservations' }] },
      from: [{ collectionId: 'reservations' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'dates' },
          op: 'ARRAY_CONTAINS',
          value: { timestampValue: zltcDayTimestamp(date) },
        },
      },
    },
  };
}

/**
 * Booked (court, segment) pairs of a `runQuery` answer for `date`. Every reservation document
 * lists its dates (recurring bookings have several) and its (court, segments) entries, which
 * apply to every date of the document. An empty day answers `[{ readTime }]`.
 */
export function parseZltcBookings(json: unknown, date: string): ZltcBookings {
  failIfError(json);
  if (!Array.isArray(json)) throw new ZltcParseError('ŽLTC reservation answer is not a list');
  const wanted = Date.parse(zltcDayTimestamp(date));
  const booked: ZltcBookings = new Map();
  let documents = 0;
  let matching = 0;
  for (const row of json as unknown[]) {
    failIfError(row);
    if (!isObject(row)) throw new ZltcParseError('ŽLTC reservation row is not an object');
    if (row.document === undefined) continue; // `{ readTime }` only
    documents += 1;
    const fields = fieldsOf(row.document, 'reservation');
    const dates = arrayValues(fields, 'dates', 'reservation').map((value) => {
      const stamp = isObject(value) ? value.timestampValue : undefined;
      if (typeof stamp !== 'string' || Number.isNaN(Date.parse(stamp))) {
        throw new ZltcParseError('ŽLTC reservation has an unreadable date');
      }
      return Date.parse(stamp);
    });
    const entries = arrayValues(fields, 'reservations', 'reservation');
    // Read every entry, also of documents for other days: a changed layout must not go unnoticed.
    const parsed = entries.map((entry) => {
      const entryFields =
        isObject(entry) && isObject(entry.mapValue) ? entry.mapValue.fields : undefined;
      if (!isObject(entryFields)) throw new ZltcParseError('ŽLTC reservation entry is not a map');
      const segments = arrayValues(entryFields, 'segment_idxs', 'reservation entry').map((v) => {
        const idx = toInteger(isObject(v) ? v.integerValue : undefined, 'reservation segment');
        if (idx < 0 || idx >= SEGMENTS_PER_DAY) {
          throw new ZltcParseError('ŽLTC reservation segment is out of range');
        }
        return idx;
      });
      return { court: stringField(entryFields, 'court_id', 'reservation entry'), segments };
    });
    if (!dates.includes(wanted)) continue;
    matching += 1;
    for (const { court, segments } of parsed) {
      const set = booked.get(court) ?? new Set<number>();
      for (const idx of segments) set.add(idx);
      booked.set(court, set);
    }
  }
  if (documents > 0 && matching === 0) {
    throw new ZltcParseError(`ŽLTC returned reservations, none of them for ${date}`);
  }
  return booked;
}

/**
 * Free courts per half hour: every season court × bookable segment (`openIdx..closeIdx`,
 * inclusive) that no reservation covers. There is no explicit "free" record in the data.
 */
export function zltcFreeHalfSlots(
  courts: readonly ZltcCourt[],
  config: ZltcConfig,
  booked: ZltcBookings,
): Map<number, Set<string>> {
  const free = new Map<number, Set<string>>();
  for (const court of seasonCourts(courts, config)) {
    const taken = booked.get(court.id);
    for (let idx = config.openIdx; idx <= config.closeIdx; idx++) {
      if (taken?.has(idx)) continue;
      const start = idx * HALF_SLOT_MINUTES;
      const set = free.get(start) ?? new Set<string>();
      set.add(court.id);
      free.set(start, set);
    }
  }
  return free;
}

/**
 * Free slots of `date`: `[]` when the club takes no reservations for it (disabled or after the
 * last allowed day); half hours that already started today (`now`) are dropped.
 */
export function zltcFreeSlots(
  courts: readonly ZltcCourt[],
  config: ZltcConfig,
  booked: ZltcBookings,
  date: string,
  now?: LocalDateTime,
): FreeSlot[] {
  if (!isBookableDate(config, date)) return [];
  if (now && date < now.date) return [];
  const free = zltcFreeHalfSlots(courts, config, booked);
  if (!now || date > now.date) return freeSlotsFromHalfSlots(free);
  return freeSlotsFromHalfSlots(new Map([...free].filter(([start]) => start > now.minutes)));
}
