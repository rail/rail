const DAY_MS = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MIN_YEAR = 1900;
const MAX_YEAR = 2999;

function toUTC(date) {
    const [year, month, day] = date.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
}

function fromUTC(ms) {
    return new Date(ms).toISOString().slice(0, 10);
}

export function isValidDate(value) {
    const match = typeof value === 'string' && DATE_RE.exec(value);
    if (!match) {
        return false;
    }
    const [year, month, day] = match.slice(1).map(Number);
    if (year < MIN_YEAR || year > MAX_YEAR) {
        return false;
    }
    const parsed = new Date(toUTC(value));
    return parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

export function addDays(date, days) {
    return fromUTC(toUTC(date) + days * DAY_MS);
}

export function addMonths(date, months) {
    const [year, month, day] = date.split('-').map(Number);
    const lastDay = new Date(Date.UTC(year, month + months, 0)).getUTCDate();
    return fromUTC(Date.UTC(year, month - 1 + months, Math.min(day, lastDay)));
}

export function daysBetween(from, to) {
    return Math.round((toUTC(to) - toUTC(from)) / DAY_MS);
}

export function weekday(date) {
    return new Date(toUTC(date)).getUTCDay();
}

export function formatDate(date) {
    return `${WEEKDAYS[weekday(date)]} ${date}`;
}

const MAX_SHIFT_DAYS = 366;
export const NO_WORKING_DAY = `No working day within ${MAX_SHIFT_DAYS} days`;

function nonWorkingReason(date, blackouts) {
    const blackout = blackouts.find((b) => b.start <= date && date <= b.end);
    if (blackout) {
        const label = blackout.label.trim();
        return label ? `blackout: ${label}` : 'blackout';
    }
    const day = weekday(date);
    return day === 0 || day === 6 ? 'weekend' : null;
}

export function adjustDate(date, blackouts) {
    const reason = nonWorkingReason(date, blackouts);
    if (!reason) {
        return { date, shifted: false };
    }
    for (let back = 1; back <= MAX_SHIFT_DAYS; back++) {
        const candidate = addDays(date, -back);
        if (!nonWorkingReason(candidate, blackouts)) {
            return { date: candidate, shifted: true, from: date, reason };
        }
    }
    return { date: null, shifted: false, error: NO_WORKING_DAY };
}

const MAX_TEXT = 60;
const MAX_ROWS = 20;
const EVERY_RANGE = { weeks: [1, 52], months: [1, 24] };
const COUNT_RANGE = [1, 24];
const AMOUNT_RANGE = [-365, 365];
const START_RANGE = [0, 9999];

export const PRESETS = {
    'rc-train': {
        label: 'RC train',
        cadence: { every: 3, unit: 'months' },
        nameTemplate: 'v1.{SEQ}.0',
        startNumber: 1,
        milestones: [
            { name: 'Feature freeze', amount: -8, unit: 'w' },
            { name: 'Branch cut', amount: -6, unit: 'w' },
            { name: 'RC1', amount: -4, unit: 'w' },
            { name: 'RC2', amount: -2, unit: 'w' },
            { name: 'First patch', amount: 2, unit: 'w' },
        ],
    },
    'calver-biannual': {
        label: 'CalVer biannual',
        cadence: { every: 6, unit: 'months' },
        nameTemplate: '{YY}.{N}',
        startNumber: 1,
        milestones: [
            { name: 'Branch cut', amount: -8, unit: 'w' },
            { name: 'Beta', amount: -6, unit: 'w' },
            { name: 'RC', amount: -3, unit: 'w' },
        ],
    },
    'simple-monthly': {
        label: 'Simple monthly',
        cadence: { every: 1, unit: 'months' },
        nameTemplate: '{YYYY}.{MM}',
        startNumber: 1,
        milestones: [{ name: 'Code freeze', amount: -1, unit: 'w' }],
    },
};

export function applyPreset(config, key) {
    const preset = PRESETS[key];
    return {
        ...config,
        cadence: { ...preset.cadence },
        nameTemplate: preset.nameTemplate,
        startNumber: preset.startNumber,
        milestones: preset.milestones.map((m) => ({ ...m })),
        nameOverrides: {},
    };
}

export function defaultConfig(today) {
    const earliest = addDays(today, 56);
    const firstGA = addDays(earliest, (8 - weekday(earliest)) % 7);
    return applyPreset({ v: 1, firstGA, count: 6, blackouts: [] }, 'calver-biannual');
}

const isIntIn = (value, [min, max]) => Number.isInteger(value) && value >= min && value <= max;
const rangeMessage = ([min, max]) => `Whole number ${min}–${max}`;
const everyRangeFor = (unit) => (Object.hasOwn(EVERY_RANGE, unit) ? EVERY_RANGE[unit] : null);

function textError(value) {
    return typeof value === 'string' && value.length <= MAX_TEXT ? null : `At most ${MAX_TEXT} characters`;
}

function milestoneErrors(milestone) {
    const errors = {};
    const name = typeof milestone?.name === 'string' ? milestone.name.trim() : '';
    if (!name) {
        errors.name = 'Name is required';
    } else if (name.length > MAX_TEXT) {
        errors.name = `At most ${MAX_TEXT} characters`;
    }
    if (!isIntIn(milestone?.amount, AMOUNT_RANGE)) {
        errors.amount = rangeMessage(AMOUNT_RANGE);
    }
    if (milestone?.unit !== 'd' && milestone?.unit !== 'w') {
        errors.unit = 'Choose days or weeks';
    }
    return errors;
}

function blackoutErrors(blackout) {
    const errors = {};
    const labelError = textError(blackout?.label);
    if (labelError) {
        errors.label = labelError;
    }
    if (!isValidDate(blackout?.start)) {
        errors.start = 'Enter a valid date';
    }
    if (!isValidDate(blackout?.end)) {
        errors.end = 'Enter a valid date';
    } else if (!errors.start && blackout.end < blackout.start) {
        errors.end = 'End must be on or after start';
    }
    return errors;
}

export function validateConfig(config) {
    const errors = {};
    if (!isValidDate(config.firstGA)) {
        errors.firstGA = 'Enter a valid date';
    }
    const everyRange = everyRangeFor(config.cadence?.unit);
    if (!everyRange) {
        errors['cadence.unit'] = 'Choose weeks or months';
    } else if (!isIntIn(config.cadence.every, everyRange)) {
        errors['cadence.every'] = rangeMessage(everyRange);
    }
    if (!isIntIn(config.count, COUNT_RANGE)) {
        errors.count = rangeMessage(COUNT_RANGE);
    }
    const templateError = textError(config.nameTemplate);
    if (templateError) {
        errors.nameTemplate = templateError;
    }
    if (!isIntIn(config.startNumber, START_RANGE)) {
        errors.startNumber = rangeMessage(START_RANGE);
    }
    if (config.milestones.length > MAX_ROWS) {
        errors.milestones = `At most ${MAX_ROWS} milestones`;
    }
    config.milestones.forEach((milestone, i) => {
        for (const [key, message] of Object.entries(milestoneErrors(milestone))) {
            errors[`milestones.${i}.${key}`] = message;
        }
    });
    if (config.blackouts.length > MAX_ROWS) {
        errors.blackouts = `At most ${MAX_ROWS} blackouts`;
    }
    config.blackouts.forEach((blackout, i) => {
        for (const [key, message] of Object.entries(blackoutErrors(blackout))) {
            errors[`blackouts.${i}.${key}`] = message;
        }
    });
    for (const [key, value] of Object.entries(config.nameOverrides)) {
        const overrideError = textError(value);
        if (overrideError) {
            errors[`nameOverrides.${key}`] = overrideError;
        }
    }
    return { ok: Object.keys(errors).length === 0, errors };
}

function milestoneDefs(milestones) {
    const defs = milestones.map((m, order) => ({
        name: m.name.trim(),
        offsetDays: m.amount * (m.unit === 'w' ? 7 : 1),
        isGA: false,
        order,
    }));
    defs.push({ name: 'GA', offsetDays: 0, isGA: true, order: -1 });
    return defs.sort((a, b) => a.offsetDays - b.offsetDays || a.order - b.order);
}

function nominalGA(config, index) {
    const { every, unit } = config.cadence;
    return unit === 'weeks'
        ? addDays(config.firstGA, index * every * 7)
        : addMonths(config.firstGA, index * every);
}

function formatName(template, { date, n, seq }) {
    const tokens = {
        YYYY: date.slice(0, 4),
        YY: date.slice(2, 4),
        MM: date.slice(5, 7),
        N: String(n),
        SEQ: String(seq),
    };
    const source = template.trim() === '' ? '{SEQ}' : template;
    return source.replace(/\{(YYYY|YY|MM|N|SEQ)\}/g, (_, token) => tokens[token]).trim();
}

function collisionWarnings(milestones) {
    const warnings = [];
    for (let i = 1; i < milestones.length; i++) {
        const [a, b] = [milestones[i - 1], milestones[i]];
        if (a.date && a.date === b.date && a.offsetDays !== b.offsetDays) {
            warnings.push(`Shifts put ${a.name} and ${b.name} on the same day (${formatDate(a.date)})`);
        }
    }
    return warnings;
}

function duplicateNameWarnings(releases) {
    const counts = new Map();
    for (const release of releases) {
        counts.set(release.name, (counts.get(release.name) ?? 0) + 1);
    }
    return [...counts].filter(([, n]) => n > 1).map(([name]) => `Duplicate release name: ${name}`);
}

export function computeSchedule(config) {
    const defs = milestoneDefs(config.milestones);
    const perYear = new Map();
    let firstYear = null;
    const releases = [];
    for (let index = 0; index < config.count; index++) {
        const nominal = nominalGA(config, index);
        const ga = adjustDate(nominal, config.blackouts);
        const milestones = defs.map(({ name, offsetDays, isGA }) => {
            const base = { name, offsetDays, isGA };
            if (ga.date === null || isGA) {
                return { ...base, ...ga };
            }
            return { ...base, ...adjustDate(addDays(ga.date, offsetDays), config.blackouts) };
        });

        const nameDate = ga.date ?? nominal;
        const year = nameDate.slice(0, 4);
        firstYear ??= year;
        const position = (perYear.get(year) ?? 0) + 1;
        perYear.set(year, position);
        const generatedName = formatName(config.nameTemplate, {
            date: nameDate,
            n: position + (year === firstYear ? config.startNumber - 1 : 0),
            seq: config.startNumber + index,
        });
        const override = config.nameOverrides[index]?.trim();

        releases.push({
            index,
            name: override || generatedName,
            generatedName,
            overridden: Boolean(override),
            milestones,
            warnings: collisionWarnings(milestones),
        });
    }
    return { releases, warnings: duplicateNameWarnings(releases) };
}

const INVALID_LINK = { error: 'Invalid link' };

function cleanOverrides(overrides, count) {
    const clean = {};
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
        return clean;
    }
    for (const [key, value] of Object.entries(overrides)) {
        const name = typeof value === 'string' ? value.trim() : '';
        if (/^\d+$/.test(key) && Number(key) < count && name && name.length <= MAX_TEXT) {
            clean[key] = name;
        }
    }
    return clean;
}

function clampInt(value, [min, max], fallback) {
    return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}

function validRows(value, errorsFor, pick, fallback) {
    if (!Array.isArray(value)) {
        return fallback;
    }
    return value
        .slice(0, MAX_ROWS)
        .filter((row) => Object.keys(errorsFor(row)).length === 0)
        .map(pick);
}

function normalizeConfig(raw, fallback) {
    const unit = everyRangeFor(raw.cadence?.unit) ? raw.cadence.unit : fallback.cadence.unit;
    const count = clampInt(raw.count, COUNT_RANGE, fallback.count);
    return {
        v: 1,
        firstGA: isValidDate(raw.firstGA) ? raw.firstGA : fallback.firstGA,
        cadence: { every: clampInt(raw.cadence?.every, EVERY_RANGE[unit], fallback.cadence.every), unit },
        count,
        nameTemplate: textError(raw.nameTemplate) ? fallback.nameTemplate : raw.nameTemplate,
        startNumber: clampInt(raw.startNumber, START_RANGE, fallback.startNumber),
        milestones: validRows(raw.milestones, milestoneErrors,
            (m) => ({ name: m.name, amount: m.amount, unit: m.unit }), fallback.milestones),
        blackouts: validRows(raw.blackouts, blackoutErrors,
            (b) => ({ label: b.label, start: b.start, end: b.end }), fallback.blackouts),
        nameOverrides: cleanOverrides(raw.nameOverrides, count),
    };
}

export function encodeConfig(config) {
    const json = JSON.stringify({ ...config, nameOverrides: cleanOverrides(config.nameOverrides, config.count) });
    let binary = '';
    for (const byte of new TextEncoder().encode(json)) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeConfig(encoded, today) {
    let raw;
    try {
        const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
        const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
        const bytes = Uint8Array.from(atob(padded), (ch) => ch.charCodeAt(0));
        raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
        return { ...INVALID_LINK };
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.v !== 1) {
        return { ...INVALID_LINK };
    }
    return { config: normalizeConfig(raw, defaultConfig(today)) };
}

const ICS_LINE_OCTETS = 75;

function icsText(value) {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\r\n|\r|\n/g, '\\n')
        .replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '');
}

function icsDate(date) {
    return date.replace(/-/g, '');
}

function foldLine(line) {
    const encoder = new TextEncoder();
    const parts = [];
    let current = '';
    let size = 0;
    let limit = ICS_LINE_OCTETS;
    for (const ch of line) {
        const bytes = encoder.encode(ch).length;
        if (size + bytes > limit) {
            parts.push(current);
            current = '';
            size = 0;
            limit = ICS_LINE_OCTETS - 1; // continuation lines start with a space
        }
        current += ch;
        size += bytes;
    }
    parts.push(current);
    return parts.join('\r\n ');
}

function slugify(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'milestone';
}

export function toICS(schedule, config, now) {
    const stamp = now.toISOString().replace(/\.\d{3}/, '').replace(/[-:]/g, '');
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//rail.sh//Release Planner//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'X-WR-CALNAME:Release schedule',
    ];
    for (const release of schedule.releases) {
        const seen = new Map();
        for (const milestone of release.milestones) {
            // Count every slug, scheduled or not, so UIDs stay stable when a milestone errors.
            const slug = slugify(milestone.name);
            const occurrence = (seen.get(slug) ?? 0) + 1;
            seen.set(slug, occurrence);
            if (!milestone.date) {
                continue;
            }
            const description = [`Release: ${release.name}`, `Milestone: ${milestone.name}`];
            if (milestone.shifted) {
                description.push(`Moved from ${formatDate(milestone.from)}: ${milestone.reason}`);
            }
            lines.push(
                'BEGIN:VEVENT',
                `UID:${config.firstGA}-${release.index}-${slug}${occurrence > 1 ? `-${occurrence}` : ''}@rail.sh`,
                `DTSTAMP:${stamp}`,
                `DTSTART;VALUE=DATE:${icsDate(milestone.date)}`,
                `DTEND;VALUE=DATE:${icsDate(addDays(milestone.date, 1))}`,
                `SUMMARY:${icsText(`${release.name} — ${milestone.name}`)}`,
                `DESCRIPTION:${icsText(description.join('\n'))}`,
                'TRANSP:TRANSPARENT',
                'END:VEVENT',
            );
        }
    }
    lines.push('END:VCALENDAR');
    return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

export function icsFilename(schedule) {
    const { releases } = schedule;
    const base = `release-schedule-${releases[0].name}-to-${releases.at(-1).name}`;
    return `${base.replace(/[^A-Za-z0-9._-]/g, '-')}.ics`;
}

function markdownText(value) {
    return value.replace(/\r\n|\r|\n/g, ' ').replace(/\|/g, '\\|');
}

export function toMarkdown(schedule) {
    const columns = schedule.releases[0].milestones.map((m) => markdownText(m.name));
    const lines = [
        `| Release | ${columns.join(' | ')} |`,
        `|${'---|'.repeat(columns.length + 1)}`,
    ];
    const shifts = [];
    for (const release of schedule.releases) {
        const cells = release.milestones.map((milestone) => {
            if (milestone.error) {
                return '⚠ error';
            }
            const date = milestone.isGA ? `**${formatDate(milestone.date)}**` : formatDate(milestone.date);
            if (!milestone.shifted) {
                return date;
            }
            shifts.push(`- ${markdownText(release.name)} ${markdownText(milestone.name)}: `
                + `${formatDate(milestone.from)} → ${formatDate(milestone.date)} (${milestone.reason})`);
            return `${date}\\*`;
        });
        lines.push(`| ${markdownText(release.name)} | ${cells.join(' | ')} |`);
    }
    if (shifts.length > 0) {
        lines.push('', '\\* Shifted dates:', ...shifts);
    }
    return `${lines.join('\n')}\n`;
}
