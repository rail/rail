import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, addMonths, daysBetween, formatDate, isValidDate, weekday } from '../planner.js';
import { NO_WORKING_DAY, adjustDate } from '../planner.js';
import { PRESETS, applyPreset, defaultConfig, validateConfig } from '../planner.js';
import { computeSchedule } from '../planner.js';
import { decodeConfig, encodeConfig } from '../planner.js';
import { icsFilename, toICS } from '../planner.js';
import { toMarkdown } from '../planner.js';

test('isValidDate accepts real calendar dates in range only', () => {
    assert.equal(isValidDate('2026-11-16'), true);
    assert.equal(isValidDate('2028-02-29'), true);
    assert.equal(isValidDate('2027-02-29'), false);
    assert.equal(isValidDate('2026-02-30'), false);
    assert.equal(isValidDate('2026-13-01'), false);
    assert.equal(isValidDate('2026-1-01'), false);
    assert.equal(isValidDate('1899-12-31'), false);
    assert.equal(isValidDate('3000-01-01'), false);
    assert.equal(isValidDate(''), false);
    assert.equal(isValidDate(undefined), false);
    assert.equal(isValidDate(20261116), false);
});

test('addDays crosses month, year, and DST boundaries', () => {
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2026-03-08', 1), '2026-03-09');
    assert.equal(addDays('2026-11-01', -1), '2026-10-31');
    assert.equal(addDays('2026-11-16', -42), '2026-10-05');
});

test('addMonths clamps to the end of shorter months', () => {
    assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
    assert.equal(addMonths('2028-01-31', 1), '2028-02-29');
    assert.equal(addMonths('2026-03-31', 1), '2026-04-30');
    assert.equal(addMonths('2026-11-16', 3), '2027-02-16');
    assert.equal(addMonths('2026-05-15', -6), '2025-11-15');
});

test('weekday, formatDate, daysBetween', () => {
    assert.equal(weekday('2026-11-16'), 1);
    assert.equal(weekday('2026-12-26'), 6);
    assert.equal(formatDate('2026-11-16'), 'Mon 2026-11-16');
    assert.equal(daysBetween('2026-11-16', '2026-12-26'), 40);
    assert.equal(daysBetween('2026-12-26', '2026-11-16'), -40);
});

const holidays = { label: 'Holidays', start: '2026-12-20', end: '2027-01-03' };

test('adjustDate leaves working days alone', () => {
    assert.deepEqual(adjustDate('2026-11-16', []), { date: '2026-11-16', shifted: false });
});

test('adjustDate moves weekends to the preceding Friday', () => {
    assert.deepEqual(adjustDate('2026-12-26', []),
        { date: '2026-12-25', shifted: true, from: '2026-12-26', reason: 'weekend' });
    assert.deepEqual(adjustDate('2026-12-27', []),
        { date: '2026-12-25', shifted: true, from: '2026-12-27', reason: 'weekend' });
});

test('adjustDate skips a blackout that runs into a weekend', () => {
    // Dec 19-20 2026 is a weekend directly before the blackout.
    assert.deepEqual(adjustDate('2026-12-21', [holidays]),
        { date: '2026-12-18', shifted: true, from: '2026-12-21', reason: 'blackout: Holidays' });
});

test('a blackout reason beats a weekend reason; unlabelled blackouts say "blackout"', () => {
    assert.equal(adjustDate('2026-12-26', [holidays]).reason, 'blackout: Holidays');
    assert.equal(adjustDate('2026-12-23', [{ label: '  ', start: '2026-12-20', end: '2026-12-31' }]).reason, 'blackout');
});

test('back-to-back blackouts are both skipped', () => {
    const first = { label: 'A', start: '2026-12-14', end: '2026-12-18' };
    const second = { label: 'B', start: '2026-12-19', end: '2026-12-23' };
    assert.deepEqual(adjustDate('2026-12-22', [first, second]),
        { date: '2026-12-11', shifted: true, from: '2026-12-22', reason: 'blackout: B' });
});

test('adjustDate gives up after 366 days', () => {
    const freeze = { label: 'Freeze', start: '2025-01-01', end: '2026-12-31' };
    assert.equal(NO_WORKING_DAY, 'No working day within 366 days');
    assert.deepEqual(adjustDate('2026-11-16', [freeze]), { date: null, shifted: false, error: NO_WORKING_DAY });
});

test('defaultConfig: CalVer biannual, first Monday at least 8 weeks out', () => {
    const config = defaultConfig('2026-10-03'); // Saturday; +56 days is Sat Nov 28
    assert.equal(config.firstGA, '2026-11-30');
    assert.equal(defaultConfig('2026-09-21').firstGA, '2026-11-16'); // Monday + 56 days is a Monday
    assert.deepEqual(config.cadence, { every: 6, unit: 'months' });
    assert.equal(config.nameTemplate, '{YY}.{N}');
    assert.equal(config.startNumber, 1);
    assert.equal(config.count, 6);
    assert.deepEqual(config.milestones.map((m) => m.name), ['Branch cut', 'Beta', 'RC']);
    assert.deepEqual(config.blackouts, []);
    assert.deepEqual(config.nameOverrides, {});
    assert.equal(validateConfig(config).ok, true);
});

test('applyPreset keeps firstGA, count, blackouts and clears overrides', () => {
    const base = { ...defaultConfig('2026-09-21'), count: 4, blackouts: [holidays], nameOverrides: { 0: 'x' } };
    const config = applyPreset(base, 'rc-train');
    assert.equal(config.firstGA, '2026-11-16');
    assert.equal(config.count, 4);
    assert.deepEqual(config.blackouts, [holidays]);
    assert.deepEqual(config.nameOverrides, {});
    assert.deepEqual(config.cadence, { every: 3, unit: 'months' });
    assert.equal(config.nameTemplate, 'v1.{SEQ}.0');
    assert.deepEqual(config.milestones.map((m) => `${m.name} ${m.amount}${m.unit}`),
        ['Feature freeze -8w', 'Branch cut -6w', 'RC1 -4w', 'RC2 -2w', 'First patch 2w']);
    config.milestones[0].name = 'changed';
    config.cadence.every = 99;
    assert.equal(PRESETS['rc-train'].milestones[0].name, 'Feature freeze');
    assert.equal(PRESETS['rc-train'].cadence.every, 3);
    const monthly = applyPreset(base, 'simple-monthly');
    assert.deepEqual(monthly.cadence, { every: 1, unit: 'months' });
    assert.equal(monthly.nameTemplate, '{YYYY}.{MM}');
});

test('validateConfig reports each invalid field by path', () => {
    const bad = {
        ...defaultConfig('2026-09-21'),
        firstGA: '2026-02-30',
        cadence: { every: 53, unit: 'weeks' },
        count: 0,
        nameTemplate: 'x'.repeat(61),
        startNumber: 1.5,
        milestones: [
            { name: '  ', amount: -6, unit: 'w' },
            { name: 'RC', amount: 366, unit: 'w' },
            { name: 'Beta', amount: -2, unit: 'm' },
            { name: 'n'.repeat(61), amount: -1, unit: 'd' },
        ],
        blackouts: [
            { label: 'Freeze', start: '2026-12-20', end: '2026-12-19' },
            { label: 'y'.repeat(61), start: 'nope', end: '2026-12-19' },
        ],
        nameOverrides: { 0: 'z'.repeat(61) },
    };
    const { ok, errors } = validateConfig(bad);
    assert.equal(ok, false);
    assert.deepEqual(Object.keys(errors).sort(), [
        'blackouts.0.end', 'blackouts.1.label', 'blackouts.1.start', 'cadence.every', 'count', 'firstGA',
        'milestones.0.name', 'milestones.1.amount', 'milestones.2.unit', 'milestones.3.name',
        'nameOverrides.0', 'nameTemplate', 'startNumber',
    ]);
    assert.equal(errors['blackouts.0.end'], 'End must be on or after start');
    assert.equal(errors['milestones.0.name'], 'Name is required');
    assert.equal(errors.count, 'Whole number 1–24');
});

test('validateConfig limits and edge values', () => {
    const good = defaultConfig('2026-09-21');
    const check = (overrides) => validateConfig({ ...good, ...overrides });
    assert.equal(check({ cadence: { every: 24, unit: 'months' } }).ok, true);
    assert.ok(check({ cadence: { every: 25, unit: 'months' } }).errors['cadence.every']);
    assert.equal(check({ cadence: { every: 52, unit: 'weeks' } }).ok, true);
    assert.ok(check({ cadence: { every: 6, unit: 'days' } }).errors['cadence.unit']);
    assert.ok(check({ cadence: { every: 6, unit: 'constructor' } }).errors['cadence.unit']);
    assert.ok(check({ count: NaN }).errors.count);
    assert.equal(check({ nameTemplate: '' }).ok, true);
    assert.equal(check({ startNumber: 0 }).ok, true);
    assert.ok(check({ startNumber: 10000 }).errors.startNumber);
    assert.equal(check({ blackouts: [{ label: '', start: '2026-12-20', end: '2026-12-20' }] }).ok, true);
    const tooManyMilestones = Array.from({ length: 21 }, (_, i) => ({ name: `M${i}`, amount: -1, unit: 'd' }));
    assert.equal(check({ milestones: tooManyMilestones }).errors.milestones, 'At most 20 milestones');
    const tooManyBlackouts = Array.from({ length: 21 }, () => ({ label: '', start: '2026-12-20', end: '2026-12-20' }));
    assert.equal(check({ blackouts: tooManyBlackouts }).errors.blackouts, 'At most 20 blackouts');
});

const cfg = (overrides = {}) => ({
    v: 1,
    firstGA: '2026-11-16',
    cadence: { every: 3, unit: 'months' },
    count: 6,
    nameTemplate: '{YY}.{N}',
    startNumber: 4,
    milestones: [
        { name: 'Branch cut', amount: -6, unit: 'w' },
        { name: 'RC', amount: -2, unit: 'w' },
    ],
    blackouts: [],
    nameOverrides: {},
    ...overrides,
});

const gaOf = (release) => release.milestones.find((m) => m.isGA);

test('quarterly GAs come from firstGA, weekends shift, {N} counts per year', () => {
    const schedule = computeSchedule(cfg());
    assert.deepEqual(schedule.releases.map((r) => gaOf(r).date),
        ['2026-11-16', '2027-02-16', '2027-05-14', '2027-08-16', '2027-11-16', '2028-02-16']);
    assert.deepEqual(gaOf(schedule.releases[2]),
        { name: 'GA', offsetDays: 0, isGA: true, date: '2027-05-14', shifted: true, from: '2027-05-16', reason: 'weekend' });
    assert.deepEqual(schedule.releases.map((r) => r.name), ['26.4', '27.1', '27.2', '27.3', '27.4', '28.1']);
    assert.deepEqual(schedule.releases.map((r) => r.index), [0, 1, 2, 3, 4, 5]);
    assert.deepEqual(schedule.warnings, []);
});

test('milestones are offset from the adjusted GA and sorted with GA first among ties', () => {
    const schedule = computeSchedule(cfg({
        milestones: [
            { name: 'Launch party', amount: 0, unit: 'd' },
            { name: 'Patch', amount: 2, unit: 'w' },
            { name: ' Branch cut ', amount: -6, unit: 'w' },
        ],
    }));
    assert.deepEqual(schedule.releases[2].milestones.map((m) => [m.name, m.offsetDays, m.date]), [
        ['Branch cut', -42, '2027-04-02'],
        ['GA', 0, '2027-05-14'],
        ['Launch party', 0, '2027-05-14'],
        ['Patch', 14, '2027-05-28'],
    ]);
    assert.deepEqual(schedule.releases[2].warnings, []);
});

test('monthly cadence from Jan 31 does not drift', () => {
    const schedule = computeSchedule(cfg({
        firstGA: '2029-01-31', cadence: { every: 1, unit: 'months' }, count: 24, milestones: [],
    }));
    const nominal = schedule.releases.map((r) => (gaOf(r).shifted ? gaOf(r).from : gaOf(r).date));
    assert.equal(nominal[1], '2029-02-28');
    assert.equal(nominal[2], '2029-03-31');
    assert.equal(nominal[23], '2030-12-31');
});

test('weekly cadence', () => {
    const schedule = computeSchedule(cfg({ cadence: { every: 2, unit: 'weeks' }, count: 3, milestones: [] }));
    assert.deepEqual(schedule.releases.map((r) => gaOf(r).date), ['2026-11-16', '2026-11-30', '2026-12-14']);
});

test('warns when shifts collapse milestones with different offsets onto one day', () => {
    const schedule = computeSchedule(cfg({
        firstGA: '2027-01-11',
        count: 1,
        milestones: [
            { name: 'RC1', amount: -24, unit: 'd' },
            { name: 'RC2', amount: -14, unit: 'd' },
            { name: 'Launch party', amount: 0, unit: 'd' },
        ],
        blackouts: [{ label: 'Holidays', start: '2026-12-21', end: '2027-01-01' }],
    }));
    const [release] = schedule.releases;
    assert.deepEqual(release.milestones.map((m) => m.date), ['2026-12-18', '2026-12-18', '2027-01-11', '2027-01-11']);
    assert.deepEqual(release.warnings, ['Shifts put RC1 and RC2 on the same day (Fri 2026-12-18)']);
});

test('a GA with no working day errors the whole release', () => {
    const schedule = computeSchedule(cfg({
        count: 2, blackouts: [{ label: 'Freeze', start: '2025-11-01', end: '2026-12-31' }],
    }));
    const [first, second] = schedule.releases;
    assert.ok(first.milestones.every((m) => m.date === null && m.error === 'No working day within 366 days'));
    assert.equal(first.name, '26.4');
    assert.equal(gaOf(second).date, '2027-02-16');
    assert.equal(second.milestones[0].date, '2027-01-05');
});

test('name tokens, empty template, adjusted-GA year', () => {
    const tokens = computeSchedule(cfg({ nameTemplate: '{YYYY}/{YY}/{MM}/{N}/{SEQ}/{X}', startNumber: 7, count: 2 }));
    assert.deepEqual(tokens.releases.map((r) => r.name), ['2026/26/11/7/7/{X}', '2027/27/02/1/8/{X}']);
    const empty = computeSchedule(cfg({ nameTemplate: '  ', startNumber: 1, count: 2 }));
    assert.deepEqual(empty.releases.map((r) => r.name), ['1', '2']);
    // Sat 2028-01-01 shifts to Fri 2027-12-31, so the name uses 2027.
    const shifted = computeSchedule(cfg({ firstGA: '2028-01-01', count: 1, nameTemplate: '{YYYY}', milestones: [] }));
    assert.equal(shifted.releases[0].name, '2027');
});

test('name overrides and duplicate-name warnings', () => {
    const schedule = computeSchedule(cfg({ count: 3, nameOverrides: { 1: '  27.1-LTS ', 2: '   ' } }));
    assert.deepEqual(schedule.releases.map((r) => [r.name, r.generatedName, r.overridden]),
        [['26.4', '26.4', false], ['27.1-LTS', '27.1', true], ['27.2', '27.2', false]]);
    const duplicates = computeSchedule(cfg({ count: 3, nameTemplate: '{YY}' }));
    assert.deepEqual(duplicates.warnings, ['Duplicate release name: 27']);
});

const TODAY = '2026-09-21';
const b64 = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

test('encodeConfig/decodeConfig round-trip, including non-ASCII', () => {
    const config = {
        ...cfg(),
        milestones: [{ name: 'Gelée 🚀', amount: -3, unit: 'w' }],
        blackouts: [holidays],
        nameOverrides: { 1: 'Ünïcode' },
    };
    const encoded = encodeConfig(config);
    assert.match(encoded, /^[A-Za-z0-9_-]+$/);
    assert.deepEqual(decodeConfig(encoded, TODAY), { config });
});

test('decodeConfig rejects garbage, non-objects, and other versions', () => {
    const bad = ['', '!!!', 'not-base64', b64('not json'), b64([1, 2]), b64(null), b64('"str"'), b64({ v: 2 })];
    for (const input of bad) {
        assert.deepEqual(decodeConfig(input, TODAY), { error: 'Invalid link' }, input);
    }
});

test('decodeConfig fills defaults for a bare {v: 1}', () => {
    assert.deepEqual(decodeConfig(b64({ v: 1 }), TODAY), { config: defaultConfig(TODAY) });
});

test('decodeConfig clamps numbers, drops invalid rows and stale overrides', () => {
    const raw = {
        v: 1,
        firstGA: 'garbage',
        cadence: { every: 99, unit: 'weeks' },
        count: 100,
        startNumber: -5,
        milestones: [
            { name: 'OK', amount: -2, unit: 'w' },
            { name: '', amount: -1, unit: 'w' },
            { name: 'Bad unit', amount: 1, unit: 'y' },
            'nope',
        ],
        blackouts: [
            { label: 'Backwards', start: '2026-12-31', end: '2026-12-01' },
            { label: 'Fine', start: '2026-12-24', end: '2026-12-26' },
        ],
        nameOverrides: { 0: ' Keep ', 30: 'Stale', 1: '', x: 'Bad key' },
    };
    const { config } = decodeConfig(b64(raw), TODAY);
    const defaults = defaultConfig(TODAY);
    assert.equal(config.firstGA, defaults.firstGA);
    assert.deepEqual(config.cadence, { every: 52, unit: 'weeks' });
    assert.equal(config.count, 24);
    assert.equal(config.startNumber, 0);
    assert.equal(config.nameTemplate, defaults.nameTemplate);
    assert.deepEqual(config.milestones, [{ name: 'OK', amount: -2, unit: 'w' }]);
    assert.deepEqual(config.blackouts, [{ label: 'Fine', start: '2026-12-24', end: '2026-12-26' }]);
    assert.deepEqual(config.nameOverrides, { 0: 'Keep' });
    assert.equal(validateConfig(config).ok, true);
});

test('decodeConfig survives wrong types and prototype-named fields (Review Focus 2)', () => {
    const raw = {
        v: 1,
        cadence: { every: '6', unit: 'constructor' },
        count: '6',
        nameTemplate: 42,
        milestones: { 0: 'x' },
        blackouts: [null, 7],
        nameOverrides: ['a'],
    };
    const { config } = decodeConfig(b64(raw), TODAY);
    assert.deepEqual(config, defaultConfig(TODAY));
    assert.equal(validateConfig(config).ok, true);
});

test('encodeConfig drops overrides beyond count and blank ones', () => {
    const encoded = encodeConfig(cfg({ count: 2, nameOverrides: { 0: 'A', 1: ' ', 5: 'Gone' } }));
    assert.deepEqual(decodeConfig(encoded, TODAY).config.nameOverrides, { 0: 'A' });
});

const NOW = new Date('2026-10-03T12:34:56.789Z');
const unfold = (ics) => ics.replace(/\r\n /g, '');

test('toICS emits all-day events with stable, de-duplicated UIDs', () => {
    const config = cfg({
        count: 1,
        milestones: [{ name: 'RC', amount: -2, unit: 'w' }, { name: 'RC', amount: -1, unit: 'w' }],
    });
    const ics = toICS(computeSchedule(config), config, NOW);
    assert.ok(ics.endsWith('\r\n'));
    assert.ok(!/[^\r]\n/.test(ics), 'every newline is CRLF');
    const lines = ics.split('\r\n');
    assert.deepEqual(lines.slice(0, 6), [
        'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//rail.sh//Release Planner//EN',
        'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Release schedule',
    ]);
    assert.equal(lines.at(-2), 'END:VCALENDAR');
    assert.equal(lines.filter((l) => l === 'BEGIN:VEVENT').length, 3);
    assert.deepEqual(lines.filter((l) => l.startsWith('UID:')),
        ['UID:2026-11-16-0-rc@rail.sh', 'UID:2026-11-16-0-rc-2@rail.sh', 'UID:2026-11-16-0-ga@rail.sh']);
    assert.ok(lines.includes('DTSTAMP:20261003T123456Z'));
    assert.ok(lines.includes('DTSTART;VALUE=DATE:20261116'));
    assert.ok(lines.includes('DTEND;VALUE=DATE:20261117'));
    assert.ok(lines.includes('SUMMARY:26.4 — GA'));
    assert.ok(lines.includes('TRANSP:TRANSPARENT'));
});

test('toICS escapes text and describes shifts (Review Focus 5)', () => {
    const config = cfg({ firstGA: '2026-12-26', count: 1, milestones: [], nameOverrides: { 0: 'a,b;c\\d' } });
    const ics = unfold(toICS(computeSchedule(config), config, NOW));
    assert.ok(ics.includes('SUMMARY:a\\,b\\;c\\\\d — GA'));
    assert.ok(ics.includes('DESCRIPTION:Release: a\\,b\\;c\\\\d\\nMilestone: GA\\nMoved from Sat 2026-12-26: weekend'));
    const multiline = cfg({ count: 1, milestones: [], nameOverrides: { 0: 'line1\nline2' } });
    assert.ok(unfold(toICS(computeSchedule(multiline), multiline, NOW)).includes('SUMMARY:line1\\nline2 — GA'));
});

test('toICS treats a bare CR as a line break and drops other control characters', () => {
    const config = cfg({
        count: 1, milestones: [], nameOverrides: { 0: 'Evil\rBEGIN:VALARM\u0000\u001b[31m' },
    });
    const ics = toICS(computeSchedule(config), config, NOW);
    assert.ok(!/\r(?!\n)/.test(ics), 'no bare CR');
    assert.ok(!/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(ics), 'no control characters');
    assert.ok(unfold(ics).includes('SUMMARY:Evil\\nBEGIN:VALARM[31m — GA'));
    assert.ok(!ics.split('\r\n').includes('BEGIN:VALARM'));
});

test('toICS folds long lines at 75 octets without splitting characters', () => {
    const cyrillic = 'Ж'.repeat(50);
    const emoji = '🚀'.repeat(30);
    const config = cfg({
        count: 1,
        milestones: [{ name: cyrillic, amount: -2, unit: 'w' }, { name: emoji, amount: -1, unit: 'w' }],
    });
    const ics = toICS(computeSchedule(config), config, NOW);
    const encoder = new TextEncoder();
    for (const line of ics.split('\r\n')) {
        assert.ok(encoder.encode(line).length <= 75, line);
        assert.ok(line.isWellFormed(), 'no split surrogate pairs');
    }
    assert.ok(ics.split('\r\n').some((l) => l.startsWith(' ')), 'something was folded');
    assert.ok(unfold(ics).includes(`SUMMARY:26.4 — ${cyrillic}`));
    assert.ok(unfold(ics).includes(`SUMMARY:26.4 — ${emoji}`));
});

test('toICS skips milestones that could not be scheduled', () => {
    const config = cfg({ count: 2, blackouts: [{ label: 'Freeze', start: '2025-11-01', end: '2026-12-31' }] });
    const ics = toICS(computeSchedule(config), config, NOW);
    assert.equal(ics.split('\r\n').filter((l) => l === 'BEGIN:VEVENT').length, 3);
});

test('icsFilename uses the first and last release names, sanitized', () => {
    const schedule = computeSchedule(cfg({ count: 3, nameOverrides: { 2: 'Big Release/Final' } }));
    assert.equal(icsFilename(schedule), 'release-schedule-26.4-to-Big-Release-Final.ics');
});

test('toMarkdown renders a table with bold GA and footnoted shifts', () => {
    const markdown = toMarkdown(computeSchedule(cfg({ count: 3 })));
    assert.equal(markdown, [
        '| Release | Branch cut | RC | GA |',
        '|---|---|---|---|',
        '| 26.4 | Mon 2026-10-05 | Mon 2026-11-02 | **Mon 2026-11-16** |',
        '| 27.1 | Tue 2027-01-05 | Tue 2027-02-02 | **Tue 2027-02-16** |',
        '| 27.2 | Fri 2027-04-02 | Fri 2027-04-30 | **Fri 2027-05-14**\\* |',
        '',
        '\\* Shifted dates:',
        '- 27.2 GA: Sun 2027-05-16 → Fri 2027-05-14 (weekend)',
        '',
    ].join('\n'));
});

test('toMarkdown omits the footnote when nothing shifted', () => {
    assert.ok(!toMarkdown(computeSchedule(cfg({ count: 1 }))).includes('Shifted'));
});

test('toMarkdown escapes pipes and flattens newlines in names (Review Focus 5)', () => {
    const piped = toMarkdown(computeSchedule(cfg({ count: 1, nameOverrides: { 0: 'A|B' } })));
    assert.ok(piped.includes('| A\\|B | Mon 2026-10-05 |'));
    const multiline = toMarkdown(computeSchedule(cfg({ count: 1, nameOverrides: { 0: 'a\nb' } })));
    assert.ok(multiline.includes('| a b | Mon 2026-10-05 |'));
    assert.equal(multiline.trimEnd().split('\n').length, 3);
});

test('toMarkdown flattens a bare CR in names', () => {
    const markdown = toMarkdown(computeSchedule(cfg({ count: 1, nameOverrides: { 0: 'a\rb\r\nc' } })));
    assert.ok(!markdown.includes('\r'));
    assert.ok(markdown.includes('| a b c | Mon 2026-10-05 |'));
});

test('toMarkdown marks unschedulable cells', () => {
    const markdown = toMarkdown(computeSchedule(cfg({
        count: 1, blackouts: [{ label: 'Freeze', start: '2025-11-01', end: '2026-12-31' }],
    })));
    assert.ok(markdown.includes('| 26.4 | ⚠ error | ⚠ error | ⚠ error |'));
});
