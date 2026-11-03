import { expect, it } from 'vitest';
import { dayStart, localDate } from '../src/time';

it('computes the Vilnius day start in winter and summer', () => {
  expect(dayStart(new Date('2026-11-03T08:00:00Z')).toISOString()).toBe('2026-11-02T22:00:00.000Z');
  expect(dayStart(new Date('2026-11-03T22:30:00Z')).toISOString()).toBe('2026-11-03T22:00:00.000Z');
  expect(dayStart(new Date('2026-07-10T12:00:00Z')).toISOString()).toBe('2026-07-09T21:00:00.000Z');
});

it('gives the local date', () => {
  expect(localDate(new Date('2026-11-03T22:30:00Z'))).toBe('2026-11-04');
  expect(localDate(new Date('2026-11-03T21:30:00Z'))).toBe('2026-11-03');
});
