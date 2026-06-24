const STORAGE_KEY = 'monitor.selectedProject';
const ACKNOWLEDGED_STORAGE_KEY = 'monitor.acknowledgedExceptions';
const DISPLAY_TIMEZONE = 'Europe/Rome';

const state = {
    view: 'dashboard',
    selectedProject: null,
    projects: [],
    selectedId: null,
    lastTree: null,
    acknowledgedExceptions: {},
    refreshSeconds: 30,
    refreshTimer: null
};

const dashboardView = document.getElementById('dashboard-view');
const dashboardStatus = document.getElementById('dashboard-status');
const dashboardUpdatedAt = document.getElementById('dashboard-updated-at');
const projectGrid = document.getElementById('project-grid');
const projectDetailView = document.getElementById('project-detail-view');
const projectDetailTitle = document.getElementById('project-detail-title');
const backToDashboard = document.getElementById('back-to-dashboard');
const projectSelect = document.getElementById('project-select');
const treeContainer = document.getElementById('exception-tree');
const exceptionCount = document.getElementById('exception-count');
const lastRefresh = document.getElementById('last-refresh');
const detailEmpty = document.getElementById('detail-empty');
const detailContent = document.getElementById('detail-content');
const detailTitle = document.getElementById('detail-title');
const detailMeta = document.getElementById('detail-meta');
const detailWarning = document.getElementById('detail-warning');
const detailLog = document.getElementById('detail-log');

function projectApiPath(project, suffix) {
    return `/api/v1/projects/${encodeURIComponent(project)}${suffix}`;
}

async function fetchJson(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Richiesta non riuscita: ${response.status}`);
    }

    return response.json();
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

function setPlaceholder(container, message) {
    container.replaceChildren(createElement('p', 'placeholder', message));
}

function formatTime(value) {
    if (!value) {
        return '—';
    }

    return new Date(value).toLocaleTimeString('it-IT', {
        timeZone: DISPLAY_TIMEZONE,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

function formatDateTime(value) {
    if (!value) {
        return '—';
    }

    return new Date(value).toLocaleString('it-IT', {
        timeZone: DISPLAY_TIMEZONE,
        dateStyle: 'short',
        timeStyle: 'medium'
    });
}

function classifyLine(text) {
    if (/\bERROR\b/.test(text)) {
        return 'error';
    }

    if (/\bWARN(ING)?\b/.test(text)) {
        return 'warn';
    }

    return '';
}

function getStatusLabel(status) {
    return {
        active: 'Attivo',
        recent: 'Recente',
        inactive: 'Inattivo',
        error: 'Errore dati'
    }[status] || 'Sconosciuto';
}

function loadAcknowledgedExceptions() {
    try {
        const stored = sessionStorage.getItem(ACKNOWLEDGED_STORAGE_KEY);
        if (!stored) {
            return {};
        }

        const parsed = JSON.parse(stored);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed
            : {};
    } catch (error) {
        return {};
    }
}

function saveAcknowledgedExceptions() {
    try {
        sessionStorage.setItem(
            ACKNOWLEDGED_STORAGE_KEY,
            JSON.stringify(state.acknowledgedExceptions)
        );
    } catch (error) {
        // La dashboard continua a funzionare anche se lo storage è disabilitato.
    }
}

function parseTimestamp(value) {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
}

function hasUnreadException(project) {
    const latest = parseTimestamp(project.metrics?.latestExceptionAt);
    if (latest === null) {
        return false;
    }

    const acknowledged = parseTimestamp(state.acknowledgedExceptions[project.id]);
    return acknowledged === null || latest > acknowledged;
}

function establishAcknowledgementBaseline(projects) {
    let changed = false;

    projects.forEach(project => {
        if (!Object.hasOwn(state.acknowledgedExceptions, project.id)) {
            state.acknowledgedExceptions[project.id] =
                project.metrics?.latestExceptionAt || null;
            changed = true;
        }
    });

    if (changed) {
        saveAcknowledgedExceptions();
    }
}

function acknowledgeProjectExceptions(project) {
    state.acknowledgedExceptions[project.id] =
        project.metrics?.latestExceptionAt || null;
    saveAcknowledgedExceptions();
}

function createMetric(label, value) {
    const metric = createElement('div', 'project-metric');
    metric.append(
        createElement('span', 'metric-label', label),
        createElement('strong', 'metric-value', String(value))
    );
    return metric;
}

function getLogGroupLabel(type) {
    return type === 'prefix' ? 'Prefix' : 'Complete';
}

function renderLogGroupSummary(project) {
    const configured = Array.isArray(project.configuredLogGroups)
        ? project.configuredLogGroups
        : [];
    const resolved = Array.isArray(project.resolvedLogGroups)
        ? project.resolvedLogGroups
        : [];
    const summary = createElement('div', 'log-group-summary');

    const label = createElement('span', 'metric-label', 'Log group');
    const count = createElement(
        'strong',
        'log-group-count',
        `${resolved.length} risolti`
    );
    summary.append(label, count);

    if (configured.length === 0) {
        summary.appendChild(createElement('span', 'log-group-empty', 'Nessuna configurazione'));
        return summary;
    }

    const badges = createElement('div', 'log-group-badges');
    configured.slice(0, 3).forEach(group => {
        const type = group.type === 'prefix' ? 'prefix' : 'complete';
        const badge = createElement(
            'span',
            `log-group-badge is-${type}`,
            `${getLogGroupLabel(type)}: ${group.value || '—'}`
        );
        badge.title = group.value || '';
        badges.appendChild(badge);
    });

    if (configured.length > 3) {
        badges.appendChild(
            createElement('span', 'log-group-badge is-more', `+${configured.length - 3}`)
        );
    }

    summary.appendChild(badges);
    return summary;
}

function createProjectCard(project) {
    const unread = project.status !== 'error' && hasUnreadException(project);
    const cardClasses = [
        'project-card',
        `status-${project.status}`,
        unread ? 'has-unread-exception' : ''
    ].filter(Boolean).join(' ');
    const button = createElement('button', cardClasses);
    button.type = 'button';
    button.dataset.projectId = project.id;

    const header = createElement('div', 'project-card-header');
    header.append(
        createElement('span', 'project-name', project.id),
        createElement(
            'span',
            'project-status',
            unread ? 'Nuova eccezione' : getStatusLabel(project.status)
        )
    );
    button.appendChild(header);

    if (project.status === 'error') {
        button.appendChild(
            createElement(
                'p',
                'project-error',
                project.error?.message || 'Metriche progetto non disponibili'
            )
        );
    } else {
        button.appendChild(renderLogGroupSummary(project));

        const metrics = createElement('div', 'metrics-grid');
        metrics.append(
            createMetric('Conservate', project.metrics.retainedExceptionCount),
            createMetric('Ultima ora', project.metrics.lastHourExceptionCount),
            createMetric('Oggi', project.metrics.todayExceptionCount),
            createMetric('File', project.metrics.exceptionFileCount)
        );
        button.appendChild(metrics);

        const latest = createElement('div', 'latest-exception');
        latest.append(
            createElement('span', 'metric-label', 'Ultima eccezione'),
            createElement('strong', '', formatDateTime(project.metrics.latestExceptionAt))
        );
        button.appendChild(latest);
    }

    button.addEventListener('click', () => {
        acknowledgeProjectExceptions(project);
        button.classList.remove('has-unread-exception');
        const statusLabel = button.querySelector('.project-status');
        if (statusLabel) {
            statusLabel.textContent = getStatusLabel(project.status);
        }

        showProjectDetail(project.id).catch(error => {
            setPlaceholder(treeContainer, `Errore apertura progetto: ${error.message}`);
        });
    });

    return button;
}

function renderDashboard(payload) {
    state.projects = payload.projects || [];
    state.refreshSeconds = payload.refreshSeconds || state.refreshSeconds;
    dashboardUpdatedAt.textContent = `Aggiornato ${formatDateTime(payload.generatedAt)}`;
    projectGrid.replaceChildren();

    if (state.projects.length === 0) {
        dashboardStatus.classList.remove('hidden');
        dashboardStatus.textContent = 'Nessun progetto configurato.';
        return;
    }

    establishAcknowledgementBaseline(state.projects);
    dashboardStatus.classList.add('hidden');
    dashboardStatus.textContent = '';
    state.projects.forEach(project => {
        projectGrid.appendChild(createProjectCard(project));
    });
    renderProjectOptions(state.projects, state.selectedProject);
}

function renderProjectOptions(projects, selectedProject) {
    projectSelect.replaceChildren();

    projects.forEach(project => {
        const option = document.createElement('option');
        option.value = project.id;
        option.textContent = project.id;
        option.selected = project.id === selectedProject;
        projectSelect.appendChild(option);
    });
}

function resolveSelectedProject(projects) {
    const storedProject = sessionStorage.getItem(STORAGE_KEY);
    if (storedProject && projects.some(project => project.id === storedProject)) {
        return storedProject;
    }

    return projects[0]?.id || null;
}

function resetDetailPanel(message = "Seleziona un'eccezione dall'albero.") {
    state.selectedId = null;
    detailContent.classList.add('hidden');
    detailEmpty.classList.remove('hidden');
    detailEmpty.textContent = message;
}

function renderTree(tree) {
    const totalExceptions = tree.files.reduce((sum, file) => sum + file.exceptionCount, 0);
    exceptionCount.textContent = String(totalExceptions);
    lastRefresh.textContent = `Aggiornato alle ${formatTime(tree.generatedAt)}`;
    treeContainer.replaceChildren();

    if (tree.files.length === 0) {
        setPlaceholder(treeContainer, 'Nessuna eccezione trovata.');
        return;
    }

    tree.files.forEach(file => {
        const fileBlock = createElement('details', 'tree-file');
        fileBlock.open = true;
        fileBlock.appendChild(
            createElement('summary', '', `${file.id} (${file.exceptionCount})`)
        );

        const list = createElement('ul', 'tree-items');
        file.exceptions.forEach(exception => {
            const item = createElement('li', 'tree-item');
            const button = createElement(
                'button',
                exception.id === state.selectedId ? 'active' : '',
                exception.preview || exception.id
            );
            button.type = 'button';
            button.dataset.exceptionId = exception.id;
            button.addEventListener('click', () => {
                state.selectedId = exception.id;
                renderTree(state.lastTree);
                loadExceptionDetail(exception.id);
            });
            item.appendChild(button);
            list.appendChild(item);
        });

        fileBlock.appendChild(list);
        treeContainer.appendChild(fileBlock);
    });
}

function renderLogLine(lineNumber, text, highlighted = false) {
    const line = createElement('div');
    line.className = ['log-line', classifyLine(text), highlighted ? 'highlight' : '']
        .filter(Boolean)
        .join(' ');
    line.textContent = `[${lineNumber}] ${text}`;
    return line;
}

function renderDetail(detail) {
    detailEmpty.classList.add('hidden');
    detailContent.classList.remove('hidden');
    detailTitle.textContent = `Eccezione ${detail.id}`;
    detailMeta.textContent = [
        detail.project || state.selectedProject,
        detail.exception.timestamp || 'timestamp n/d',
        detail.exception.source || 'sorgente n/d',
        detail.files.exceptionFile,
        detail.exception.lineNumberInMain ? `main:${detail.exception.lineNumberInMain}` : 'main:n/d'
    ].join(' · ');

    if (detail.warning) {
        detailWarning.textContent = `Avviso: ${detail.warning}`;
        detailWarning.classList.remove('hidden');
    } else {
        detailWarning.classList.add('hidden');
    }

    const lines = [];
    detail.context.before.forEach(entry => {
        lines.push(renderLogLine(entry.lineNumber, entry.text));
    });
    lines.push(renderLogLine(
        detail.exception.lineNumberInMain || detail.exception.lineNumberInExceptionFile,
        detail.exception.line,
        true
    ));
    detail.context.after.forEach(entry => {
        lines.push(renderLogLine(entry.lineNumber, entry.text));
    });
    detailLog.replaceChildren(...lines);
}

async function loadExceptionDetail(exceptionId) {
    if (!state.selectedProject) {
        resetDetailPanel('Seleziona prima un progetto.');
        return;
    }

    const requestedProject = state.selectedProject;

    try {
        const detail = await fetchJson(
            projectApiPath(requestedProject, `/exceptions/${encodeURIComponent(exceptionId)}`)
        );

        if (
            state.view !== 'project-detail'
            || state.selectedProject !== requestedProject
            || state.selectedId !== exceptionId
        ) {
            return;
        }

        renderDetail(detail);
    } catch (error) {
        if (
            state.view !== 'project-detail'
            || state.selectedProject !== requestedProject
            || state.selectedId !== exceptionId
        ) {
            return;
        }

        resetDetailPanel(`Errore caricamento dettaglio: ${error.message}`);
    }
}

async function refreshDashboard() {
    try {
        const payload = await fetchJson('/api/v1/dashboard');
        renderDashboard(payload);
    } catch (error) {
        dashboardStatus.classList.remove('hidden');
        dashboardStatus.textContent = `Errore caricamento cruscotto: ${error.message}`;
        projectGrid.replaceChildren();
    }
}

async function refreshTree() {
    if (!state.selectedProject) {
        setPlaceholder(treeContainer, 'Seleziona un progetto.');
        return;
    }

    const requestedProject = state.selectedProject;

    try {
        const [health, tree] = await Promise.all([
            fetchJson(projectApiPath(requestedProject, '/health')),
            fetchJson(projectApiPath(requestedProject, '/exceptions/tree'))
        ]);

        if (
            state.view !== 'project-detail'
            || state.selectedProject !== requestedProject
        ) {
            return;
        }

        state.refreshSeconds = health.treeRefreshSeconds || state.refreshSeconds;
        state.lastTree = tree;
        renderTree(tree);

        if (state.selectedId) {
            const stillExists = tree.files.some(file =>
                file.exceptions.some(exception => exception.id === state.selectedId)
            );
            if (stillExists) {
                await loadExceptionDetail(state.selectedId);
            } else {
                resetDetailPanel();
            }
        }
    } catch (error) {
        if (
            state.view !== 'project-detail'
            || state.selectedProject !== requestedProject
        ) {
            return;
        }

        setPlaceholder(treeContainer, `Errore caricamento eccezioni: ${error.message}`);
    }
}

async function refreshCurrentView() {
    if (state.view === 'project-detail') {
        await refreshTree();
        return;
    }

    await refreshDashboard();
}

function scheduleRefresh() {
    if (state.refreshTimer) {
        clearInterval(state.refreshTimer);
    }

    state.refreshTimer = setInterval(() => {
        refreshCurrentView();
    }, state.refreshSeconds * 1000);
}

function showDashboard() {
    state.view = 'dashboard';
    dashboardView.classList.remove('hidden');
    projectDetailView.classList.add('hidden');
    scheduleRefresh();
    return refreshDashboard();
}

async function showProjectDetail(projectId) {
    state.view = 'project-detail';
    state.selectedProject = projectId;
    state.lastTree = null;
    sessionStorage.setItem(STORAGE_KEY, projectId);
    projectDetailTitle.textContent = projectId;
    dashboardView.classList.add('hidden');
    projectDetailView.classList.remove('hidden');
    renderProjectOptions(state.projects, projectId);
    resetDetailPanel();
    setPlaceholder(treeContainer, 'Caricamento eccezioni…');
    await refreshTree();
    scheduleRefresh();
}

async function handleProjectChange(nextProject) {
    if (!nextProject || nextProject === state.selectedProject) {
        return;
    }

    await showProjectDetail(nextProject);
}

async function initMonitorUi() {
    state.acknowledgedExceptions = loadAcknowledgedExceptions();
    backToDashboard.addEventListener('click', () => {
        showDashboard();
    });
    projectSelect.addEventListener('change', event => {
        handleProjectChange(event.target.value).catch(error => {
            setPlaceholder(treeContainer, `Errore cambio progetto: ${error.message}`);
        });
    });

    await refreshDashboard();
    state.selectedProject = resolveSelectedProject(state.projects);
    renderProjectOptions(state.projects, state.selectedProject);
    scheduleRefresh();
}

initMonitorUi();
