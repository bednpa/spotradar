import type { Court, SportId, Venue } from '@spotradar/shared';

/**
 * Fictional demo venues in Brno. Names and addresses are invented; only the
 * districts and approximate coordinates are realistic.
 */

interface CourtGroup {
  label: string;
  count: number;
  sports: SportId[];
  indoor: boolean;
  surface: string;
}

function buildCourts(venueId: string, groups: CourtGroup[]): Court[] {
  const courts: Court[] = [];
  let n = 0;
  for (const group of groups) {
    for (let i = 1; i <= group.count; i++) {
      n++;
      courts.push({
        id: `${venueId}-court-${n}`,
        name: `${group.label} ${i}`,
        sports: [...group.sports],
        indoor: group.indoor,
        surface: group.surface,
      });
    }
  }
  return courts;
}

const LESNA = 'venue-lesna-racket-club';
const CENTRUM = 'venue-centrum-sport-hall';
const KRALOVO_POLE = 'venue-kralovo-pole-padel';
const LISEN = 'venue-lisen-courts';
const BYSTRC = 'venue-bystrc-beach-club';
const VINOHRADY = 'venue-vinohrady-smash-centre';
const LISKOVEC = 'venue-liskovec-arena';
const ZABOVRESKY = 'venue-zabovresky-tennis-park';
const PISARKY = 'venue-pisarky-sand-and-rackets';

export const SEED_VENUES: Venue[] = [
  {
    id: LESNA,
    name: 'Lesná Racket Club',
    cityId: 'brno',
    address: 'Tuháčkova 14, 638 00 Brno-Lesná',
    location: { lat: 49.226, lng: 16.627 },
    openingHours: { open: '07:00', close: '22:00' },
    pricePerHourCzk: { tennis: 420, badminton: 260, squash: 300 },
    courts: buildCourts(LESNA, [
      { label: 'Tennis court', count: 3, sports: ['tennis'], indoor: false, surface: 'clay' },
      { label: 'Badminton court', count: 2, sports: ['badminton'], indoor: true, surface: 'sport flooring' },
      { label: 'Squash court', count: 1, sports: ['squash'], indoor: true, surface: 'wood' },
    ]),
  },
  {
    id: CENTRUM,
    name: 'Centrum Sport Hall',
    cityId: 'brno',
    address: 'Kounicova 31, 602 00 Brno-střed',
    location: { lat: 49.2065, lng: 16.6005 },
    openingHours: { open: '08:00', close: '22:00' },
    pricePerHourCzk: { badminton: 280, squash: 340, 'table-tennis': 150 },
    courts: buildCourts(CENTRUM, [
      { label: 'Badminton court', count: 3, sports: ['badminton'], indoor: true, surface: 'sport flooring' },
      { label: 'Squash court', count: 2, sports: ['squash'], indoor: true, surface: 'wood' },
      { label: 'Table', count: 1, sports: ['table-tennis'], indoor: true, surface: 'parquet' },
    ]),
  },
  {
    id: KRALOVO_POLE,
    name: 'Královo Pole Padel Arena',
    cityId: 'brno',
    address: 'Palackého třída 120, 612 00 Brno-Královo Pole',
    location: { lat: 49.2335, lng: 16.5945 },
    openingHours: { open: '07:00', close: '22:00' },
    pricePerHourCzk: { padel: 600, tennis: 450 },
    courts: buildCourts(KRALOVO_POLE, [
      { label: 'Padel court', count: 4, sports: ['padel'], indoor: true, surface: 'artificial turf' },
      { label: 'Tennis court', count: 2, sports: ['tennis'], indoor: true, surface: 'hard' },
    ]),
  },
  {
    id: LISEN,
    name: 'Líšeň Courts',
    cityId: 'brno',
    address: 'Zelená 5, 628 00 Brno-Líšeň',
    location: { lat: 49.2092, lng: 16.7035 },
    openingHours: { open: '09:00', close: '21:00' },
    pricePerHourCzk: { tennis: 220, 'table-tennis': 150, badminton: 190 },
    courts: buildCourts(LISEN, [
      { label: 'Tennis court', count: 2, sports: ['tennis'], indoor: false, surface: 'clay' },
      { label: 'Table', count: 2, sports: ['table-tennis'], indoor: true, surface: 'parquet' },
      { label: 'Badminton court', count: 2, sports: ['badminton'], indoor: true, surface: 'sport flooring' },
    ]),
  },
  {
    id: BYSTRC,
    name: 'Bystrc Beach Club',
    cityId: 'brno',
    address: 'Přístavní 22, 635 00 Brno-Bystrc',
    location: { lat: 49.2268, lng: 16.5232 },
    openingHours: { open: '08:00', close: '21:00' },
    pricePerHourCzk: { 'beach-volleyball': 350, padel: 520 },
    courts: buildCourts(BYSTRC, [
      { label: 'Sand court', count: 3, sports: ['beach-volleyball'], indoor: false, surface: 'sand' },
      { label: 'Padel court', count: 2, sports: ['padel'], indoor: false, surface: 'artificial turf' },
    ]),
  },
  {
    id: VINOHRADY,
    name: 'Vinohrady Smash Centre',
    cityId: 'brno',
    address: 'Chironova 8, 615 00 Brno-Vinohrady',
    location: { lat: 49.2162, lng: 16.6665 },
    openingHours: { open: '07:00', close: '22:00' },
    pricePerHourCzk: { squash: 320, badminton: 250, 'table-tennis': 160, padel: 650 },
    courts: buildCourts(VINOHRADY, [
      { label: 'Squash court', count: 2, sports: ['squash'], indoor: true, surface: 'wood' },
      { label: 'Badminton court', count: 2, sports: ['badminton'], indoor: true, surface: 'sport flooring' },
      { label: 'Table', count: 1, sports: ['table-tennis'], indoor: true, surface: 'parquet' },
      { label: 'Padel court', count: 1, sports: ['padel'], indoor: true, surface: 'artificial turf' },
    ]),
  },
  {
    id: LISKOVEC,
    name: 'Starý Lískovec Arena',
    cityId: 'brno',
    address: 'Bellova 40, 625 00 Brno-Starý Lískovec',
    location: { lat: 49.1795, lng: 16.5712 },
    openingHours: { open: '08:00', close: '21:00' },
    pricePerHourCzk: { 'table-tennis': 150, badminton: 200, squash: 260 },
    courts: buildCourts(LISKOVEC, [
      { label: 'Table', count: 3, sports: ['table-tennis'], indoor: true, surface: 'parquet' },
      { label: 'Badminton court', count: 2, sports: ['badminton'], indoor: true, surface: 'sport flooring' },
      { label: 'Squash court', count: 1, sports: ['squash'], indoor: true, surface: 'wood' },
    ]),
  },
  {
    id: ZABOVRESKY,
    name: 'Žabovřesky Tennis Park',
    cityId: 'brno',
    address: 'Vinohradská 91, 616 00 Brno-Žabovřesky',
    location: { lat: 49.2142, lng: 16.5782 },
    openingHours: { open: '07:00', close: '21:00' },
    pricePerHourCzk: { tennis: 380, 'beach-volleyball': 300 },
    courts: buildCourts(ZABOVRESKY, [
      { label: 'Tennis court', count: 4, sports: ['tennis'], indoor: false, surface: 'clay' },
      { label: 'Sand court', count: 2, sports: ['beach-volleyball'], indoor: false, surface: 'sand' },
    ]),
  },
  {
    id: PISARKY,
    name: 'Pisárky Sand & Rackets',
    cityId: 'brno',
    address: 'Pisárecká 3, 603 00 Brno-Pisárky',
    location: { lat: 49.2051, lng: 16.5798 },
    openingHours: { open: '09:00', close: '22:00' },
    pricePerHourCzk: { 'beach-volleyball': 330, tennis: 360, 'table-tennis': 170 },
    courts: buildCourts(PISARKY, [
      { label: 'Sand court', count: 2, sports: ['beach-volleyball'], indoor: false, surface: 'sand' },
      { label: 'Tennis court', count: 2, sports: ['tennis'], indoor: false, surface: 'hard' },
      { label: 'Table', count: 2, sports: ['table-tennis'], indoor: true, surface: 'parquet' },
    ]),
  },
];
