import { timeToMinutes } from '@spotradar/shared';
import type { Reservation } from '@spotradar/shared';

/** State storage for in-app reservations. Swappable (in-memory, JSON file, ...). */
export interface ReservationRepository {
  create(reservation: Reservation): Reservation;
  findById(id: string): Reservation | undefined;
  /** True if any stored reservation of the court overlaps [startMin, endMin) on the date. */
  hasOverlap(courtId: string, date: string, startMin: number, endMin: number): boolean;
  clear(): void;
}

export function createInMemoryReservationRepository(): ReservationRepository {
  const byId = new Map<string, Reservation>();
  return {
    create(reservation) {
      byId.set(reservation.id, reservation);
      return reservation;
    },
    findById(id) {
      return byId.get(id);
    },
    hasOverlap(courtId, date, startMin, endMin) {
      for (const r of byId.values()) {
        if (r.courtId !== courtId || r.date !== date) continue;
        const rStart = timeToMinutes(r.time);
        const rEnd = rStart + r.durationMinutes;
        if (rStart < endMin && startMin < rEnd) return true;
      }
      return false;
    },
    clear() {
      byId.clear();
    },
  };
}
