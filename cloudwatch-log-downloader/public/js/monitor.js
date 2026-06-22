const STORAGE_KEY = 'monitor.selectedProject';

const state = {
    selectedProject: null,
    projects: [],
    selectedId: null,
    lastTree: null,
    refreshSeconds: 30,
    refreshTimer: null
};

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
        throw new Error(`Request failed: ${response.status}`);
    }

    return response.json();
}

function formatRefreshTime(date) {
    return date.toLocaleTimeString('en-US');
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

function resetDetailPanel(message = 'Select an exception from the tree') {
    state.selectedId = null;
    detailContent.classList.add('hidden');
    detailEmpty.classList.remove('hidden');
    detailEmpty.textContent = message;
}

function resolveSelectedProject(projects) {
    const storedProject = sessionStorage.getItem(STORAGE_KEY);
    if (storedProject && projects.some(project => project.id === storedProject)) {
        return storedProject;
    }

    return projects[0]?.id || null;
}

function renderProjectOptions(projects, selectedProject) {
    projectSelect.innerHTML = '';

    projects.forEach(project => {
        const option = document.createElement('option');
        option.value = project.id;
        option.textContent = project.id;
        option.selected = project.id === selectedProject;
        projectSelect.appendChild(option);
    });

    projectSelect.classList.toggle('hidden', projects.length <= 1);
}

async function loadProjects() {
    const payload = await fetchJson('/api/v1/projects');
    state.projects = payload.projects || [];

    if (state.projects.length === 0) {
        throw new Error('No monitored projects configured');
    }

    state.selectedProject = resolveSelectedProject(state.projects);
    sessionStorage.setItem(STORAGE_KEY, state.selectedProject);
    renderProjectOptions(state.projects, state.selectedProject);
}

function renderTree(tree) {
    const totalExceptions = tree.files.reduce((sum, file) => sum + file.exceptionCount, 0);
    exceptionCount.textContent = String(totalExceptions);
    lastRefresh.textContent = `Updated ${formatRefreshTime(new Date(tree.generatedAt))}`;

    if (tree.files.length === 0) {
        treeContainer.innerHTML = '<p class="placeholder">No exceptions found</p>';
        return;
    }

    treeContainer.innerHTML = '';

    tree.files.forEach(file => {
        const fileBlock = document.createElement('details');
        fileBlock.className = 'tree-file';
        fileBlock.open = true;

        const summary = document.createElement('summary');
        summary.textContent = `${file.id} (${file.exceptionCount})`;
        fileBlock.appendChild(summary);

        const list = document.createElement('ul');
        list.className = 'tree-items';

        file.exceptions.forEach(exception => {
            const item = document.createElement('li');
            item.className = 'tree-item';

            const button = document.createElement('button');
            button.type = 'button';
            button.dataset.exceptionId = exception.id;
            button.textContent = exception.preview || exception.id;
            button.className = exception.id === state.selectedId ? 'active' : '';

            button.addEventListener('click', () => {
                state.selectedId = exception.id;
                if (state.lastTree) {
                    renderTree(state.lastTree);
                }
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
    const line = document.createElement('div');
    line.className = ['log-line', classifyLine(text), highlighted ? 'highlight' : '']
        .filter(Boolean)
        .join(' ');
    line.textContent = `[${lineNumber}] ${text}`;
    return line;
}

function renderDetail(detail) {
    detailEmpty.classList.add('hidden');
    detailContent.classList.remove('hidden');

    detailTitle.textContent = `Exception ${detail.id}`;
    detailMeta.textContent = [
        detail.project || state.selectedProject,
        detail.exception.timestamp || 'timestamp n/d',
        detail.exception.source || 'source n/d',
        detail.files.exceptionFile,
        detail.exception.lineNumberInMain ? `main:${detail.exception.lineNumberInMain}` : 'main:n/d'
    ].join(' · ');

    if (detail.warning) {
        detailWarning.textContent = `Warning: ${detail.warning}`;
        detailWarning.classList.remove('hidden');
    } else {
        detailWarning.classList.add('hidden');
    }

    detailLog.innerHTML = '';

    detail.context.before.forEach(entry => {
        detailLog.appendChild(renderLogLine(entry.lineNumber, entry.text));
    });

    detailLog.appendChild(
        renderLogLine(
            detail.exception.lineNumberInMain || detail.exception.lineNumberInExceptionFile,
            detail.exception.line,
            true
        )
    );

    detail.context.after.forEach(entry => {
        detailLog.appendChild(renderLogLine(entry.lineNumber, entry.text));
    });
}

async function loadExceptionDetail(exceptionId) {
    if (!state.selectedProject) {
        resetDetailPanel('Select a project first');
        return;
    }

    try {
        const detail = await fetchJson(
            projectApiPath(state.selectedProject, `/exceptions/${encodeURIComponent(exceptionId)}`)
        );
        renderDetail(detail);
    } catch (error) {
        resetDetailPanel(`Error loading detail: ${error.message}`);
    }
}

function scheduleRefresh() {
    if (state.refreshTimer) {
        clearInterval(state.refreshTimer);
    }

    state.refreshTimer = setInterval(refreshTree, state.refreshSeconds * 1000);
}

async function refreshTree() {
    if (!state.selectedProject) {
        treeContainer.innerHTML = '<p class="placeholder">Select a project to load exceptions</p>';
        return;
    }

    try {
        const [health, tree] = await Promise.all([
            fetchJson(projectApiPath(state.selectedProject, '/health')),
            fetchJson(projectApiPath(state.selectedProject, '/exceptions/tree'))
        ]);

        const nextRefreshSeconds = health.treeRefreshSeconds || state.refreshSeconds;
        if (nextRefreshSeconds !== state.refreshSeconds) {
            state.refreshSeconds = nextRefreshSeconds;
            scheduleRefresh();
        }

        state.lastTree = tree;
        renderTree(tree);

        if (state.selectedId) {
            const stillExists = tree.files.some(file =>
                file.exceptions.some(exception => exception.id === state.selectedId)
            );

            if (stillExists) {
                await loadExceptionDetail(state.selectedId);
            } else {
                resetDetailPanel('Select an exception from the tree');
            }
        }
    } catch (error) {
        treeContainer.innerHTML = `<p class="placeholder">Error loading tree: ${error.message}</p>`;
    }
}

async function handleProjectChange(nextProject) {
    if (!nextProject || nextProject === state.selectedProject) {
        return;
    }

    state.selectedProject = nextProject;
    sessionStorage.setItem(STORAGE_KEY, nextProject);
    state.lastTree = null;
    resetDetailPanel('Select an exception from the tree');
    await refreshTree();
}

async function initMonitorUi() {
    try {
        await loadProjects();
        projectSelect.addEventListener('change', event => {
            handleProjectChange(event.target.value).catch(error => {
                treeContainer.innerHTML = `<p class="placeholder">Error switching project: ${error.message}</p>`;
            });
        });
        await refreshTree();
        scheduleRefresh();
    } catch (error) {
        treeContainer.innerHTML = `<p class="placeholder">Error loading projects: ${error.message}</p>`;
        resetDetailPanel('Unable to load monitor projects');
    }
}

initMonitorUi();
