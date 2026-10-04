import {
    PRESETS,
    addDays,
    applyPreset,
    computeSchedule,
    daysBetween,
    decodeConfig,
    defaultConfig,
    encodeConfig,
    formatDate,
    icsFilename,
    isValidDate,
    toICS,
    toMarkdown,
    validateConfig,
} from './planner.js';

const MAX_ROWS = 20;

const $ = (id) => document.getElementById(id);

const state = {
    today: localToday(),
    config: null,
    schedule: null,
    nameOverrides: {},
};

function localToday() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
}

function setAttributes(node, attributes) {
    for (const [name, value] of Object.entries(attributes)) {
        if (value !== undefined && value !== null && value !== false) {
            node.setAttribute(name, String(value));
        }
    }
}

function el(tag, attributes = {}, ...children) {
    const node = document.createElement(tag);
    setAttributes(node, attributes);
    node.append(...children);
    return node;
}

const toInt = (text) => (text.trim() === '' ? NaN : Number(text));
const inputValue = (number) => (Number.isFinite(number) ? number : '');

function rowField(id, prefix, labelText, control, showLabel = false) {
    control.id = id;
    control.setAttribute('aria-describedby', `${id}-error`);
    const label = el('label', { for: id, class: showLabel ? 'row-label' : 'visually-hidden' },
        el('span', { class: 'visually-hidden' }, `${prefix} `), labelText);
    return el('div', { class: 'field' }, label, control, el('p', { class: 'field-error', id: `${id}-error` }));
}

function deleteButton(action, index, label) {
    return el('button', {
        type: 'button', class: 'icon-button', 'data-action': action, 'data-index': index, 'aria-label': label,
    }, '×');
}

function renderMilestoneRows(milestones) {
    const rows = milestones.map((milestone, i) => {
        const prefix = `Milestone ${i + 1}`;
        const unit = el('select', { 'data-key': 'unit', 'data-path': `milestones.${i}.unit` },
            el('option', { value: 'd' }, 'days'),
            el('option', { value: 'w' }, 'weeks'));
        unit.value = milestone.unit;
        return el('div', { class: 'row milestone-row' },
            rowField(`ms-${i}-name`, prefix, 'name', el('input', {
                type: 'text', value: milestone.name, maxlength: 60, placeholder: 'Milestone name',
                autocomplete: 'off', 'data-key': 'name', 'data-path': `milestones.${i}.name`,
            })),
            rowField(`ms-${i}-amount`, prefix, 'offset from GA', el('input', {
                type: 'number', value: inputValue(milestone.amount), min: -365, max: 365, step: 1,
                'data-key': 'amount', 'data-path': `milestones.${i}.amount`,
            })),
            rowField(`ms-${i}-unit`, prefix, 'offset unit', unit),
            deleteButton('delete-milestone', i, `Delete milestone ${i + 1}`));
    });
    $('milestone-rows').replaceChildren(...rows);
    $('add-milestone').disabled = milestones.length >= MAX_ROWS;
}

function renderBlackoutRows(blackouts) {
    const rows = blackouts.map((blackout, i) => {
        const prefix = `Blackout ${i + 1}`;
        return el('div', { class: 'row blackout-row' },
            rowField(`bo-${i}-label`, prefix, 'Label', el('input', {
                type: 'text', value: blackout.label, maxlength: 60, placeholder: 'Optional',
                autocomplete: 'off', 'data-key': 'label', 'data-path': `blackouts.${i}.label`,
            }), true),
            rowField(`bo-${i}-start`, prefix, 'Start', el('input', {
                type: 'date', value: blackout.start, 'data-key': 'start', 'data-path': `blackouts.${i}.start`,
            }), true),
            rowField(`bo-${i}-end`, prefix, 'End', el('input', {
                type: 'date', value: blackout.end, 'data-key': 'end', 'data-path': `blackouts.${i}.end`,
            }), true),
            deleteButton('delete-blackout', i, `Delete blackout ${i + 1}`));
    });
    $('blackout-rows').replaceChildren(...rows);
    $('blackouts-empty').hidden = blackouts.length > 0;
    $('add-blackout').disabled = blackouts.length >= MAX_ROWS;
}

function readRows(containerId, keys) {
    return [...$(containerId).children].map((row) => Object.fromEntries(
        keys.map((key) => [key, row.querySelector(`[data-key="${key}"]`).value])));
}

function readForm() {
    return {
        v: 1,
        firstGA: $('first-ga').value,
        cadence: { every: toInt($('every').value), unit: $('unit').value },
        count: toInt($('count').value),
        nameTemplate: $('name-template').value,
        startNumber: toInt($('start-number').value),
        milestones: readRows('milestone-rows', ['name', 'amount', 'unit'])
            .map((row) => ({ ...row, amount: toInt(row.amount) })),
        blackouts: readRows('blackout-rows', ['label', 'start', 'end']),
        nameOverrides: { ...state.nameOverrides },
    };
}

function writeForm(config) {
    $('first-ga').value = config.firstGA;
    $('every').value = config.cadence.every;
    $('unit').value = config.cadence.unit;
    $('count').value = config.count;
    $('name-template').value = config.nameTemplate;
    $('start-number').value = config.startNumber;
    renderMilestoneRows(config.milestones);
    renderBlackoutRows(config.blackouts);
    state.nameOverrides = { ...config.nameOverrides };
}

function showErrors(errors) {
    for (const input of $('config').querySelectorAll('[data-path]')) {
        const message = errors[input.dataset.path] ?? '';
        if (message) {
            input.setAttribute('aria-invalid', 'true');
        } else {
            input.removeAttribute('aria-invalid');
        }
        const errorElement = $(`${input.id}-error`);
        if (errorElement) {
            errorElement.textContent = message;
        }
    }
}

function dateCell(milestone) {
    const cell = el('td', { class: milestone.isGA ? 'ga' : undefined });
    if (milestone.error) {
        cell.classList.add('error');
        cell.append(`⚠ ${milestone.error}`);
        return cell;
    }
    cell.append(formatDate(milestone.date));
    if (milestone.shifted) {
        const note = `Moved from ${formatDate(milestone.from)}: ${milestone.reason}`;
        cell.append(el('span', { class: 'shift', role: 'img', title: note, 'aria-label': note }, '↶'));
    }
    return cell;
}

function nameCell(release) {
    const wrapper = el('div', { class: 'name-cell' }, el('input', {
        type: 'text', class: 'release-name', value: release.name, maxlength: 60, autocomplete: 'off',
        'data-index': release.index, 'aria-label': `Release ${release.index + 1} name`,
    }));
    if (release.overridden) {
        wrapper.append(el('button', {
            type: 'button', class: 'icon-button reset-name', 'data-index': release.index,
            title: `Reset to ${release.generatedName}`, 'aria-label': `Reset name to ${release.generatedName}`,
        }, '↺'));
    }
    return el('th', { scope: 'row' }, wrapper);
}

function captureTableFocus(tbody) {
    const focused = document.activeElement;
    if (!tbody.contains(focused) || focused.dataset.index === undefined) {
        return null;
    }
    return {
        index: focused.dataset.index,
        className: focused.classList.contains('reset-name') ? 'reset-name' : 'release-name',
        selection: 'selectionStart' in focused ? [focused.selectionStart, focused.selectionEnd] : null,
    };
}

function restoreTableFocus(tbody, saved) {
    if (!saved) {
        return;
    }
    const target = tbody.querySelector(`.${saved.className}[data-index="${saved.index}"]`)
        ?? tbody.querySelector(`.release-name[data-index="${saved.index}"]`);
    target?.focus();
    if (target && saved.selection && 'setSelectionRange' in target) {
        target.setSelectionRange(...saved.selection);
    }
}

function renderTable(schedule) {
    const table = $('schedule-table');
    const tbody = table.tBodies[0];
    const savedFocus = captureTableFocus(tbody);
    const columns = schedule.releases[0].milestones;
    table.tHead.replaceChildren(el('tr', {},
        el('th', { scope: 'col' }, 'Release'),
        ...columns.map((m) => el('th', { scope: 'col', class: m.isGA ? 'ga' : undefined }, m.name))));
    const rows = [];
    for (const release of schedule.releases) {
        rows.push(el('tr', {}, nameCell(release), ...release.milestones.map(dateCell)));
        if (release.warnings.length > 0) {
            rows.push(el('tr', { class: 'warning-row' },
                el('td', { colspan: columns.length + 1 }, `⚠ ${release.warnings.join('; ')}`)));
        }
    }
    tbody.replaceChildren(...rows);
    restoreTableFocus(tbody, savedFocus);
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TIMELINE = { laneHeight: 28, labelWidth: 120, axisHeight: 28, padding: 14, pxPerDay: 1.5, minWidth: 720 };

function svg(tag, attributes = {}, ...children) {
    const node = document.createElementNS(SVG_NS, tag);
    setAttributes(node, attributes);
    node.append(...children);
    return node;
}

const truncate = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function axisTicks(start, end) {
    const months = daysBetween(start, end) / 30.44;
    const step = months <= 18 ? 1 : months <= 48 ? 3 : 12;
    const [year, month, day] = start.split('-').map(Number);
    let monthIndex = year * 12 + (month - 1) + (day > 1 ? 1 : 0);
    monthIndex = Math.ceil(monthIndex / step) * step;
    const ticks = [];
    for (;; monthIndex += step) {
        const tickYear = Math.floor(monthIndex / 12);
        const tickMonth = monthIndex % 12;
        const date = `${tickYear}-${String(tickMonth + 1).padStart(2, '0')}-01`;
        if (date > end) {
            break;
        }
        let label = `${MONTHS[tickMonth]} ${tickYear}`;
        if (step === 12 || (step === 1 && tickMonth === 0)) {
            label = String(tickYear);
        } else if (step === 1) {
            label = MONTHS[tickMonth];
        }
        ticks.push({ date, label });
    }
    return ticks;
}

function renderTimeline(schedule, config) {
    const timeline = $('timeline');
    const dates = schedule.releases
        .flatMap((release) => release.milestones)
        .filter((milestone) => milestone.date)
        .map((milestone) => milestone.date)
        .sort();
    if (dates.length === 0) {
        timeline.replaceChildren();
        setAttributes(timeline, { width: 0, height: 0 });
        return;
    }

    const { laneHeight, labelWidth, axisHeight, padding, pxPerDay, minWidth } = TIMELINE;
    const start = addDays(dates[0], -7);
    const end = addDays(dates.at(-1), 7);
    const rangeDays = daysBetween(start, end);
    const width = Math.max(timeline.parentElement.clientWidth, minWidth, Math.round(rangeDays * pxPerDay));
    const plotRight = width - padding;
    const x = (date) => labelWidth + (daysBetween(start, date) / rangeDays) * (plotRight - labelWidth);
    const top = axisHeight;
    const bottom = axisHeight + schedule.releases.length * laneHeight;
    const height = bottom + padding;
    const nodes = [];

    for (const blackout of config.blackouts) {
        if (blackout.end < start || blackout.start > end) {
            continue;
        }
        const x1 = x(blackout.start < start ? start : blackout.start);
        const x2 = Math.min(plotRight, x(addDays(blackout.end, 1)));
        nodes.push(svg('rect', { class: 'tl-blackout', x: x1, y: top, width: Math.max(1, x2 - x1), height: bottom - top },
            svg('title', {}, blackout.label.trim() || 'Blackout')));
    }

    for (const tick of axisTicks(start, end)) {
        const tickX = x(tick.date);
        nodes.push(
            svg('line', { class: 'tl-grid', x1: tickX, x2: tickX, y1: top - 6, y2: bottom }),
            svg('text', { class: 'tl-tick', x: tickX + 3, y: top - 10 }, tick.label));
    }

    schedule.releases.forEach((release, lane) => {
        const y = top + lane * laneHeight + laneHeight / 2;
        nodes.push(
            svg('text', { class: 'tl-label', x: padding, y: y + 4 },
                truncate(release.name, 14), svg('title', {}, release.name)),
            svg('line', { class: 'tl-lane', x1: labelWidth, x2: plotRight, y1: y, y2: y }));
        for (const milestone of release.milestones) {
            if (!milestone.date) {
                continue;
            }
            const tip = [`${release.name} — ${milestone.name}`, formatDate(milestone.date)];
            if (milestone.shifted) {
                tip.push(`Moved from ${formatDate(milestone.from)}: ${milestone.reason}`);
            }
            const classes = ['tl-marker', milestone.isGA && 'ga', milestone.shifted && 'shifted']
                .filter(Boolean).join(' ');
            nodes.push(svg('circle', { class: classes, cx: x(milestone.date), cy: y, r: milestone.isGA ? 7 : 4.5 },
                svg('title', {}, tip.join('\n'))));
        }
    });

    if (state.today >= start && state.today <= end) {
        const todayX = x(state.today);
        nodes.push(
            svg('line', { class: 'tl-today', x1: todayX, x2: todayX, y1: top - 6, y2: bottom }),
            svg('text', { class: 'tl-today-label', x: todayX + 3, y: bottom + 11 }, 'today'));
    }

    setAttributes(timeline, { width, height, viewBox: `0 0 ${width} ${height}` });
    timeline.replaceChildren(...nodes);
}

function renderWarnings(schedule) {
    $('schedule-warnings').replaceChildren(...schedule.warnings.map((warning) => el('li', {}, warning)));
    const milestones = schedule.releases.flatMap((release) => release.milestones);
    const total = schedule.warnings.length
        + schedule.releases.reduce((sum, release) => sum + release.warnings.length, 0)
        + milestones.filter((milestone) => milestone.error).length;
    const badge = $('warning-count');
    badge.hidden = total === 0;
    badge.textContent = `⚠ ${total} ${total === 1 ? 'warning' : 'warnings'}`;
}

function renderResults() {
    renderWarnings(state.schedule);
    renderTimeline(state.schedule, state.config);
    renderTable(state.schedule);
}

const HASH_DELAY_MS = 300;
const FLASH_MS = 2000;
const BAD_LINK_NOTICE = "Couldn't read the schedule in this link; showing defaults.";

let hashTimer = null;
const flashTimers = new WeakMap();

function writeHash() {
    hashTimer = null;
    history.replaceState(null, '', `#c=${encodeConfig(state.config)}`);
}

function scheduleHashUpdate() {
    clearTimeout(hashTimer);
    hashTimer = setTimeout(writeHash, HASH_DELAY_MS);
}

function flushHash() {
    if (hashTimer !== null) {
        clearTimeout(hashTimer);
        writeHash();
    }
}

function showNotice(text = '') {
    $('notice-text').textContent = text;
    $('notice').hidden = !text;
}

function loadFromHash() {
    const match = /^#c=(.*)$/.exec(location.hash);
    const result = match ? decodeConfig(match[1], state.today) : { config: defaultConfig(state.today) };
    showNotice(result.error ? BAD_LINK_NOTICE : '');
    load(result.config ?? defaultConfig(state.today));
}

function flash(button, text) {
    if (!button.dataset.label) {
        button.dataset.label = button.textContent;
    }
    button.textContent = text;
    $('status').textContent = text;
    clearTimeout(flashTimers.get(button));
    flashTimers.set(button, setTimeout(() => {
        button.textContent = button.dataset.label;
        $('status').textContent = '';
    }, FLASH_MS));
}

async function copyText(text, button) {
    try {
        await navigator.clipboard.writeText(text);
        flash(button, 'Copied ✓');
    } catch {
        $('copy-text').value = text;
        $('copy-dialog').showModal();
        $('copy-text').select();
    }
}

function downloadICS(button) {
    const text = toICS(state.schedule, state.config, new Date());
    const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
    const link = el('a', { href: url, download: icsFilename(state.schedule) });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    flash(button, 'Downloaded ✓');
}

function update() {
    const draft = readForm();
    const { ok, errors } = validateConfig(draft);
    showErrors(errors);
    if (!ok) {
        return;
    }
    state.config = draft;
    state.schedule = computeSchedule(draft);
    renderResults();
    scheduleHashUpdate();
}

function load(config) {
    writeForm(config);
    update();
}

function wireEvents() {
    const form = $('config');
    form.addEventListener('submit', (event) => event.preventDefault());
    form.addEventListener('input', (event) => {
        if (event.target.id !== 'preset') {
            update();
        }
    });
    $('preset').addEventListener('change', (event) => {
        const key = event.target.value;
        if (!key) {
            return;
        }
        load(applyPreset(readForm(), key));
        event.target.value = '';
    });
    $('add-milestone').addEventListener('click', () => {
        const draft = readForm();
        draft.milestones.push({ name: '', amount: -1, unit: 'w' });
        renderMilestoneRows(draft.milestones);
        update();
        $(`ms-${draft.milestones.length - 1}-name`).focus();
    });
    $('add-blackout').addEventListener('click', () => {
        const draft = readForm();
        const year = Number((isValidDate(draft.firstGA) ? draft.firstGA : state.today).slice(0, 4));
        draft.blackouts.push({ label: 'Holidays', start: `${year}-12-20`, end: `${year + 1}-01-03` });
        renderBlackoutRows(draft.blackouts);
        update();
        $(`bo-${draft.blackouts.length - 1}-label`).focus();
    });
    form.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-action]');
        if (!button) {
            return;
        }
        const draft = readForm();
        const index = Number(button.dataset.index);
        if (button.dataset.action === 'delete-milestone') {
            draft.milestones.splice(index, 1);
            renderMilestoneRows(draft.milestones);
            $('add-milestone').focus();
        } else {
            draft.blackouts.splice(index, 1);
            renderBlackoutRows(draft.blackouts);
            $('add-blackout').focus();
        }
        update();
    });

    const tbody = $('schedule-table').tBodies[0];
    tbody.addEventListener('change', (event) => {
        if (!event.target.matches('.release-name')) {
            return;
        }
        const index = event.target.dataset.index;
        const name = event.target.value.trim();
        if (name && name !== state.schedule.releases[index].generatedName) {
            state.nameOverrides[index] = name;
        } else {
            delete state.nameOverrides[index];
        }
        // `change` fires mid focus-move; rebuild after focus lands so the next field keeps it.
        setTimeout(update);
    });
    tbody.addEventListener('click', (event) => {
        const button = event.target.closest('.reset-name');
        if (button) {
            delete state.nameOverrides[button.dataset.index];
            update();
        }
    });

    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (state.schedule) {
                renderTimeline(state.schedule, state.config);
            }
        }, 150);
    });

    $('copy-link').addEventListener('click', (event) => {
        flushHash();
        copyText(location.href, event.currentTarget);
    });
    $('download-ics').addEventListener('click', (event) => downloadICS(event.currentTarget));
    $('copy-markdown').addEventListener('click', (event) => copyText(toMarkdown(state.schedule), event.currentTarget));
    $('notice-dismiss').addEventListener('click', () => showNotice());
    window.addEventListener('hashchange', loadFromHash);
}

function init() {
    for (const [key, preset] of Object.entries(PRESETS)) {
        $('preset').append(el('option', { value: key }, preset.label));
    }
    wireEvents();
    loadFromHash();
}

init();
