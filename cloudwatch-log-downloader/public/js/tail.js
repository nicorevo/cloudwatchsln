const TAIL_PROJECT_STORAGE_KEY = 'monitor.tailProject';
const POLL_INTERVAL_MS = 2000;
const INITIAL_LIMIT = 200;
const MAX_VISIBLE_LINES = 1000;
const BOTTOM_THRESHOLD_PX = 48;

const state = {
    selectedProject: null,
    cursor: null,
    paused: false,
    wrap: true,
    autoFollow: true,
    requestInFlight: false,
    generation: 0,
    pollTimer: null,
    visibleLineIds: new Set()
};

const projectSelect = document.getElementById('tail-project-select');
const pauseButton = document.getElementById('tail-pause');
const wrapButton = document.getElementById('tail-wrap');
const clearButton = document.getElementById('tail-clear');
const followButton = document.getElementById('tail-follow');
const viewer = document.getElementById('tail-viewer');
const liveStatus = document.getElementById('tail-live-status');
const message = document.getElementById('tail-message');
const lineCount = document.getElementById('tail-line-count');

async function fetchJson(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Richiesta non riuscita: ${response.status}`);
    }
    return response.json();
}

function projectTailPath(project, cursor = null) {
    return `/api/v1/projects/${encodeURIComponent(project)}/tail?limit=${INITIAL_LIMIT}`
        + (cursor ? `&after=${encodeURIComponent(cursor)}` : '');
}

function createElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) {
        element.className = className;
    }
    if (text !== undefined) {
        element.textContent = text;
    }
    return element;
}

function readStoredProject(projects) {
    try {
        const stored = sessionStorage.getItem(TAIL_PROJECT_STORAGE_KEY);
        return projects.some(project => project.id === stored)
            ? stored
            : projects[0]?.id || null;
    } catch (error) {
        return projects[0]?.id || null;
    }
}

function storeSelectedProject(project) {
    try {
        sessionStorage.setItem(TAIL_PROJECT_STORAGE_KEY, project);
    } catch (error) {
        // Il tail resta utilizzabile se lo storage è disabilitato.
    }
}

function renderProjectOptions(projects) {
    projectSelect.replaceChildren();
    projects.forEach(project => {
        const option = document.createElement('option');
        option.value = project.id;
        option.textContent = project.id;
        option.selected = project.id === state.selectedProject;
        projectSelect.appendChild(option);
    });
}

function formatTimestamp(value) {
    if (!value) {
        return '—';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleTimeString('it-IT', {
        timeZone: 'Europe/Rome',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3
    });
}

function createLogLine(line) {
    const classes = ['tail-line'];
    if (line.isException) {
        classes.push('tail-line-exception');
    } else if (/\bWARN(ING)?\b/.test(line.message || '')) {
        classes.push('tail-line-warning');
    }

    const row = createElement('div', classes.join(' '));
    row.dataset.lineId = line.id;
    if (line.isException) {
        row.appendChild(createElement('span', 'sr-only', 'Eccezione: '));
    }
    row.append(
        createElement('time', 'tail-time', formatTimestamp(line.timestamp)),
        createElement('span', 'tail-source', line.source || 'sorgente n/d'),
        createElement('span', 'tail-message-text', line.message || line.raw || '')
    );
    return row;
}

function isNearBottom() {
    return viewer.scrollHeight - viewer.scrollTop - viewer.clientHeight
        <= BOTTOM_THRESHOLD_PX;
}

function updateFollowState() {
    followButton.classList.toggle('hidden', state.autoFollow);
}

function updateLineCount() {
    const count = viewer.childElementCount;
    lineCount.textContent = `${count} ${count === 1 ? 'riga' : 'righe'}`;
}

function trimViewer() {
    while (viewer.childElementCount > MAX_VISIBLE_LINES) {
        const first = viewer.firstElementChild;
        state.visibleLineIds.delete(first.dataset.lineId);
        first.remove();
    }
}

function appendLines(lines) {
    const shouldFollow = state.autoFollow || isNearBottom();
    const fragment = document.createDocumentFragment();

    lines.forEach(line => {
        if (!line.id || state.visibleLineIds.has(line.id)) {
            return;
        }
        state.visibleLineIds.add(line.id);
        fragment.appendChild(createLogLine(line));
    });

    viewer.appendChild(fragment);
    trimViewer();
    updateLineCount();

    if (shouldFollow) {
        followLive();
    }
}

function clearViewer() {
    viewer.replaceChildren();
    state.visibleLineIds.clear();
    updateLineCount();
}

function followLive() {
    state.autoFollow = true;
    viewer.scrollTop = viewer.scrollHeight;
    updateFollowState();
}

function schedulePoll(delay = POLL_INTERVAL_MS) {
    clearTimeout(state.pollTimer);
    if (state.paused || !state.selectedProject) {
        return;
    }
    state.pollTimer = setTimeout(fetchTail, delay);
}

async function fetchTail() {
    if (state.paused || !state.selectedProject) {
        return;
    }

    if (state.requestInFlight) {
        schedulePoll(50);
        return;
    }

    const requestedProject = state.selectedProject;
    const requestedGeneration = state.generation;
    state.requestInFlight = true;

    try {
        const payload = await fetchJson(
            projectTailPath(requestedProject, state.cursor)
        );
        if (
            requestedGeneration !== state.generation
            || requestedProject !== state.selectedProject
            || state.paused
        ) {
            return;
        }

        if (payload.reset) {
            clearViewer();
            message.textContent = 'Il tail è stato riallineato.';
        } else if (payload.lines.length === 0 && !state.cursor) {
            message.textContent = 'Nessun log disponibile.';
        } else {
            message.textContent = 'Log locali raccolti dal downloader.';
        }

        appendLines(payload.lines || []);
        state.cursor = payload.cursor;
        liveStatus.textContent = '● LIVE';
        liveStatus.classList.add('is-live');
        schedulePoll(payload.hasMore ? 0 : POLL_INTERVAL_MS);
    } catch (error) {
        if (requestedGeneration === state.generation) {
            message.textContent = `Errore tail: ${error.message}`;
            liveStatus.textContent = 'Errore';
            liveStatus.classList.remove('is-live');
            schedulePoll(POLL_INTERVAL_MS);
        }
    } finally {
        state.requestInFlight = false;
    }
}

function resetProject(project) {
    state.generation += 1;
    state.selectedProject = project;
    state.cursor = null;
    state.paused = false;
    clearTimeout(state.pollTimer);
    clearViewer();
    followLive();
    storeSelectedProject(project);
    pauseButton.textContent = 'Pausa';
    liveStatus.textContent = 'Avvio…';
    message.textContent = 'Caricamento log…';
    schedulePoll(0);
}

function togglePause() {
    state.paused = !state.paused;
    state.generation += 1;
    clearTimeout(state.pollTimer);
    pauseButton.textContent = state.paused ? 'Riprendi' : 'Pausa';
    liveStatus.textContent = state.paused ? 'In pausa' : '● LIVE';
    liveStatus.classList.toggle('is-live', !state.paused);
    if (!state.paused) {
        schedulePoll(0);
    }
}

function toggleWrap() {
    state.wrap = !state.wrap;
    viewer.classList.toggle('no-wrap', !state.wrap);
    wrapButton.textContent = `A capo: ${state.wrap ? 'sì' : 'no'}`;
    wrapButton.setAttribute('aria-pressed', String(state.wrap));
}

async function initTail() {
    const payload = await fetchJson('/api/v1/projects');
    const projects = payload.projects || [];

    if (projects.length === 0) {
        message.textContent = 'Nessun progetto configurato.';
        projectSelect.disabled = true;
        return;
    }

    state.selectedProject = readStoredProject(projects);
    renderProjectOptions(projects);
    resetProject(state.selectedProject);
}

projectSelect.addEventListener('change', event => resetProject(event.target.value));
pauseButton.addEventListener('click', togglePause);
wrapButton.addEventListener('click', toggleWrap);
clearButton.addEventListener('click', clearViewer);
followButton.addEventListener('click', followLive);
viewer.addEventListener('scroll', () => {
    state.autoFollow = isNearBottom();
    updateFollowState();
});

initTail().catch(error => {
    message.textContent = `Errore inizializzazione tail: ${error.message}`;
    liveStatus.textContent = 'Errore';
});
