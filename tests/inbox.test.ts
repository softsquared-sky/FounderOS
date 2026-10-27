import { describe, expect, test } from 'vitest';
import type { CommsItem } from '@/lib/comms';
import type { CalEvent } from '@/lib/connectors/gcal';
import {
  BUCKET_LABEL,
  buildThreads,
  countBy,
  dateBucket,
  filterThreads,
  initials,
  messagesFor,
  orderThreads,
  parseTitle,
  relativeTime,
  triageOf,
} from '@/lib/inbox';

const NOW = new Date(2026, 8, 16, 15, 0, 0); // local afternoon in every test timezone
const ago = (mins: number) => new Date(NOW.getTime() - mins * 60_000).toISOString();
const ahead = (mins: number) => new Date(NOW.getTime() + mins * 60_000).toISOString();

const item = (over: Partial<CommsItem> & Pick<CommsItem, 'source' | 'title' | 'preview'>): CommsItem => ({
  ts: ago(10),
  ...over,
});

const event = (over: Partial<CalEvent> & Pick<CalEvent, 'id' | 'title' | 'start'>): CalEvent => ({
  account: 'Work',
  color: '#5ec9f8',
  end: null,
  allDay: false,
  location: null,
  joinUrl: null,
  ...over,
});

describe('inbox: who and where', () => {
  test('email splits "Name — Org", slack "#channel — Name", whatsapp "Name (brand)"', () => {
    expect(parseTitle(item({ source: 'email', title: 'Dara Whitfield — Northwind Logistics', preview: '' }))).toEqual({
      sender: 'Dara Whitfield',
      context: 'Northwind Logistics',
    });
    expect(parseTitle(item({ source: 'slack', title: '#delivery — Juno Bellamy', preview: '' }))).toEqual({
      sender: 'Juno Bellamy',
      context: '#delivery',
    });
    expect(parseTitle(item({ source: 'whatsapp', title: 'Sol Acme (brand)', preview: '' }))).toEqual({ sender: 'Sol Acme', context: 'brand' });
    expect(parseTitle(item({ source: 'whatsapp', title: 'Koda Reyes', preview: '' }))).toEqual({ sender: 'Koda Reyes', context: 'WhatsApp' });
  });

  test('initials take the first two words and skip a leading #', () => {
    expect(initials('Dara Whitfield')).toBe('DW');
    expect(initials('#delivery')).toBe('D');
    expect(initials('Cassian & Vale')).toBe('C&');
  });
});

describe('inbox: triage is derived from the message and explained', () => {
  test('a question or a priority-1 contact needs a reply', () => {
    const q = triageOf(item({ source: 'email', title: 'A — B', preview: 'When can the team start onboarding?' }), NOW);
    expect(q.triage).toBe('reply');
    expect(q.reasons).toContain('They asked a question');
    const p1 = triageOf(item({ source: 'whatsapp', title: 'A', preview: 'Footage is in the drive.', priority: 1, unread: 1 }), NOW);
    expect(p1.triage).toBe('reply');
    expect(p1.reasons).toEqual(['Priority 1 contact', '1 unread message']);
  });

  test('"sending / attached / circling back" without a question is waiting on them', () => {
    const w = triageOf(item({ source: 'email', title: 'A — B', preview: 'Sending the countersigned copy today.' }), NOW);
    expect(w.triage).toBe('waiting');
    expect(w.reasons).toContain('They said what happens next');
  });

  test('older than three days with nothing unread is done, unless it is a priority-1 contact', () => {
    expect(triageOf(item({ source: 'slack', title: '#x — Y', preview: 'Can we move the Thursday call?', ts: ago(5 * 1440) }), NOW).triage).toBe('done');
    expect(triageOf(item({ source: 'slack', title: '#x — Y', preview: 'Can we move it?', ts: ago(5 * 1440), priority: 1 }), NOW).triage).toBe('reply');
  });

  test('everything else is FYI with a plain reason', () => {
    const f = triageOf(item({ source: 'slack', title: '#alerts — Yeat', preview: 'Cleared 12GB of build cache.' }), NOW);
    expect(f.triage).toBe('fyi');
    expect(f.reasons).toEqual(['Nothing to send back']);
  });
});

describe('inbox: one list for every channel', () => {
  const feed: CommsItem[] = [
    item({ source: 'email', title: 'Dara Whitfield — Northwind Logistics', preview: 'When can the team start?', ts: ago(14), unread: 2, priority: 1, replyTo: 'd@x.example' }),
    item({ source: 'slack', title: '#delivery — Juno Bellamy', preview: 'Provisioned.', ts: ago(63) }),
    item({ source: 'whatsapp', title: 'Mars Delacroix', preview: 'Footage is in the drive.', ts: ago(1500) }),
    item({ source: 'email', title: 'Old — Thing', preview: 'Notes are in the doc', ts: ago(20 * 1440) }),
  ];
  const events: CalEvent[] = [
    event({ id: 'e1', title: 'Security review', start: ahead(90), joinUrl: 'https://meet.example/x' }),
    event({ id: 'e2', title: 'Partner meeting', start: ahead(3 * 1440), location: 'Office' }),
    event({ id: 'e3', title: 'Pipeline review', start: ago(1440 + 120) }),
  ];
  const threads = buildThreads(feed, events, NOW);

  test('meetings become threads with the source spelled out and their details attached', () => {
    const m = threads.find((t) => t.key === 'calendar-e1')!;
    expect(m.source).toBe('calendar');
    expect(m.sender).toBe('Security review');
    expect(m.preview).toBe('Video call');
    expect(m.event?.joinUrl).toBe('https://meet.example/x');
    expect(threads.find((t) => t.key === 'calendar-e3')!.triage).toBe('done');
  });

  test('reading order: today\'s upcoming meetings first, then the past newest-first, later meetings last', () => {
    expect(threads.map((t) => t.sender)).toEqual([
      'Security review',
      'Dara Whitfield',
      'Juno Bellamy',
      'Mars Delacroix',
      'Pipeline review',
      'Old',
      'Partner meeting',
    ]);
    expect(orderThreads([...threads].reverse(), NOW).map((t) => t.sender)).toEqual(threads.map((t) => t.sender));
  });

  test('day buckets label the groups', () => {
    expect(dateBucket(ahead(90), NOW)).toBe('next');
    expect(dateBucket(ahead(3 * 1440), NOW)).toBe('later');
    expect(dateBucket(ago(14), NOW)).toBe('today');
    expect(dateBucket(ago(1500), NOW)).toBe('yesterday');
    expect(dateBucket(ago(4 * 1440), NOW)).toBe('week');
    expect(dateBucket(ago(20 * 1440), NOW)).toBe('older');
    expect(BUCKET_LABEL.next).toBe('Up next');
  });

  test('filters narrow by source, queue, range and free text', () => {
    expect(filterThreads(threads, { source: 'calendar' }, NOW)).toHaveLength(3);
    expect(filterThreads(threads, { triage: 'reply' }, NOW).map((t) => t.sender)).toEqual(['Dara Whitfield']);
    expect(filterThreads(threads, { range: 'today' }, NOW).map((t) => t.sender)).toEqual(['Security review', 'Dara Whitfield', 'Juno Bellamy']);
    expect(filterThreads(threads, { range: 'week' }, NOW).map((t) => t.sender)).not.toContain('Partner meeting');
    expect(filterThreads(threads, { query: 'northwind' }, NOW).map((t) => t.sender)).toEqual(['Dara Whitfield']);
    expect(filterThreads(threads, { query: 'office' }, NOW).map((t) => t.sender)).toEqual(['Partner meeting']);
  });

  test('counts feed the triage column', () => {
    expect(countBy(threads, (t) => t.source)).toEqual({ email: 2, slack: 1, whatsapp: 1, calendar: 3 });
  });

  test('the reader shows the scripted history when one exists, else the single latest message', () => {
    const dara = threads.find((t) => t.sender === 'Dara Whitfield')!;
    expect(messagesFor(dara)).toEqual([{ from: 'them', text: 'When can the team start?', ts: dara.ts }]);
    const history = [{ from: 'me' as const, text: 'Form attached.', ts: ago(1440) }, { from: 'them' as const, text: 'Signed.', ts: ago(14) }];
    expect(messagesFor(dara, { 'Dara Whitfield': history })).toBe(history);
  });

  test('relative time reads both ways', () => {
    expect(relativeTime(ago(0), NOW)).toBe('now');
    expect(relativeTime(ago(14), NOW)).toBe('14m');
    expect(relativeTime(ago(180), NOW)).toBe('3h');
    expect(relativeTime(ago(3 * 1440), NOW)).toBe('3d');
    expect(relativeTime(ahead(20), NOW)).toBe('in 20m');
    expect(relativeTime(ahead(180), NOW)).toBe('in 3h');
  });
});
