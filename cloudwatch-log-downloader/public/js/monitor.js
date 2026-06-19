const state = {
    selectedId: null,
    lastTree: null,
    refreshSeconds: 30,
    refreshTimer: null
};

const treeContainer = document.getElementById('exception-tree');
const exceptionCount = document.getElementById('exception-count');
const lastRefresh = document.getElementById('last-refresh');
const detailEmpty = document.getElementById('detail-empty');
const detailContent = document.getElementById('detail-content');
const detailTitle = document.getElementById('detail-title');
const detailMeta = document.getElementById('detail-meta');
const detailWarning = document.getElementById('detail-warning');
const detailLog = document.getElementById('detail-log');

async function fetchJson(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
    }

    return response.json();
}

function formatRefreshTime(date) {
    return date.toLocaleTimeString('it-IT');
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

function renderTree(tree) {
    const totalExceptions = tree.files.reduce((sum, file) => sum + file.exceptionCount, 0);
    exceptionCount.textContent = String(totalExceptions);
    lastRefresh.textContent = `Aggiornato ${formatRefreshTime(new Date(tree.generatedAt))}`;

    if (tree.files.length === 0) {
        treeContainer.innerHTML = '<p class="placeholder">Nessuna eccezione trovata</p>';
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

    detailTitle.textContent = `Eccezione ${detail.id}`;
    detailMeta.textContent = [
        detail.exception.timestamp || 'timestamp n/d',
        detail.exception.source || 'source n/d',
        detail.files.exceptionFile,
        detail.exception.lineNumberInMain ? `main:${detail.exception.lineNumberInMain}` : 'main:n/d'
    ].join(' · ');

    if (detail.warning) {
        detailWarning.textContent = `Attenzione: ${detail.warning}`;
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
    try {
        const detail = await fetchJson(`/api/v1/exceptions/${encodeURIComponent(exceptionId)}`);
        renderDetail(detail);
    } catch (error) {
        detailEmpty.classList.remove('hidden');
        detailContent.classList.add('hidden');
        detailEmpty.textContent = `Errore caricamento dettaglio: ${error.message}`;
    }
}

function scheduleRefresh() {
    if (state.refreshTimer) {
        clearInterval(state.refreshTimer);
    }

    state.refreshTimer = setInterval(refreshTree, state.refreshSeconds * 1000);
}

async function refreshTree() {
    try {
        const [health, tree] = await Promise.all([
            fetchJson('/api/v1/health'),
            fetchJson('/api/v1/exceptions/tree')
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
                state.selectedId = null;
                detailContent.classList.add('hidden');
                detailEmpty.classList.remove('hidden');
                detailEmpty.textContent = 'Seleziona un\'eccezione dall\'albero';
            }
        }
    } catch (error) {
        treeContainer.innerHTML = `<p class="placeholder">Errore caricamento albero: ${error.message}</p>`;
    }
}

async function initMonitorUi() {
    await refreshTree();
    scheduleRefresh();
}

initMonitorUi();
