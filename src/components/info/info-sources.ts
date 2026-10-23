/**
 * What docs/research/LPU_PUBLIC_SOURCES.md (research date 2026-10-23) found
 * for each student-information service. Nothing here is a data feed: where an
 * official page exists it is offered as an external link, with a plain
 * statement of what it does and does not contain.
 */
import type { IconName } from '../ui/index.ts';

export const RESEARCH_DATE = '2026-10-23';

export interface UnavailableService {
  id: 'mess' | 'transport' | 'events' | 'faculty';
  title: string;
  icon: IconName;
  /** Why the app shows nothing. */
  finding: string;
  /** Official pages related to the topic (external; not imported). */
  links: ReadonlyArray<{ label: string; url: string; note: string }>;
  /** An in-app action that is genuinely useful instead (optional). */
  action?: { label: string; categoryId: string };
}

export const UNAVAILABLE_SERVICES: readonly UnavailableService[] = [
  {
    id: 'mess',
    title: 'Mess & food menus',
    icon: 'utensils',
    finding: 'LPU publishes no public mess menu. The official residence page only says that a mess exists.',
    links: [
      {
        label: 'Hostels & residences (lpu.in)',
        url: 'https://www.lpu.in/student-services/residence.php',
        note: 'Room types and fees; mentions the mess, no menu.',
      },
    ],
    action: { label: 'Show mapped food places', categoryId: 'food' },
  },
  {
    id: 'transport',
    title: 'Transport & shuttle',
    icon: 'bus',
    finding:
      'No official timetable is published. The transport page lists day-scholar bus routes, pickup points and annual charges, but no times, and there is no on-campus shuttle information.',
    links: [
      {
        label: 'Transport facility (lpu.in)',
        url: 'https://www.lpu.in/student-services/transport.php',
        note: 'Bus routes from nearby cities and charges; no timetable.',
      },
    ],
    action: { label: 'Show mapped transport stops', categoryId: 'transport' },
  },
  {
    id: 'events',
    title: 'Events & announcements',
    icon: 'star',
    finding:
      'LPU publishes write-ups of past events and a news feed, not a schedule of upcoming events with dates and venues, so there is nothing reliable to list here.',
    links: [
      {
        label: 'Campus events (lpu.in)',
        url: 'https://www.lpu.in/campus-life/campus-events.php',
        note: 'Reports on past events.',
      },
      {
        label: 'LPU Happenings news',
        url: 'https://happenings.lpu.in/',
        note: 'University news posts.',
      },
    ],
  },
  {
    id: 'faculty',
    title: 'Faculty directory',
    icon: 'school',
    finding:
      'Official faculty listings exist, but they are personal data, the site’s terms forbid reuse, and faculty office locations are not published, so a directory would add nothing to the map.',
    links: [
      {
        label: 'Faculty (lpu.in)',
        url: 'https://www.lpu.in/faculty/',
        note: 'The official listing, on LPU’s site.',
      },
    ],
  },
];
