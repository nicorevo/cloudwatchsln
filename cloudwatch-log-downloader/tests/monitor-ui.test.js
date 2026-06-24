const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

test('index.html include dropdown progetto', () => {
    const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');

    assert.match(html, /id="project-select"/);
    assert.match(html, /class="project-select"/);
});

test('index.html include dashboard e vista dettaglio separate', () => {
    const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');

    assert.match(html, /id="dashboard-view"/);
    assert.match(html, /id="project-grid"/);
    assert.match(html, /id="dashboard-updated-at"/);
    assert.match(html, /id="project-detail-view"/);
    assert.match(html, /id="back-to-dashboard"/);
    assert.match(html, /aria-live="polite"/);
});

test('header dashboard mostra solo brand e aggiornamento sulla stessa riga', () => {
    const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');

    assert.match(html, /class="dashboard-brand">CloudWatch Log Downloader/);
    assert.match(html, /id="dashboard-updated-at"/);
    assert.doesNotMatch(html, />Console monitoraggio</);
    assert.doesNotMatch(html, /Stato delle eccezioni rilevate/);
    assert.match(html, /href="\/tail"/);
});

test('monitor.js usa API scoped per progetto', () => {
    const js = fs.readFileSync(path.join(PUBLIC_DIR, 'js', 'monitor.js'), 'utf8');

    assert.match(js, /\/api\/v1\/projects/);
    assert.match(js, /monitor\.selectedProject/);
    assert.match(js, /\/exceptions\/tree/);
    assert.doesNotMatch(js, /fetchJson\('\/api\/v1\/exceptions\/tree'\)/);
});

test('monitor.js gestisce cambio progetto', () => {
    const js = fs.readFileSync(path.join(PUBLIC_DIR, 'js', 'monitor.js'), 'utf8');

    assert.match(js, /handleProjectChange/);
    assert.match(js, /projectSelect\.addEventListener\('change'/);
});

test('monitor.js carica e renderizza la dashboard aggregata', () => {
    const js = fs.readFileSync(path.join(PUBLIC_DIR, 'js', 'monitor.js'), 'utf8');

    assert.match(js, /fetchJson\('\/api\/v1\/dashboard'\)/);
    assert.match(js, /retainedExceptionCount/);
    assert.match(js, /lastHourExceptionCount/);
    assert.match(js, /todayExceptionCount/);
    assert.match(js, /exceptionFileCount/);
    assert.match(js, /latestExceptionAt/);
    assert.match(js, /showDashboard/);
    assert.match(js, /showProjectDetail/);
    assert.doesNotMatch(js, /progetti monitorati/);
});

test('monitor.js evita rendering HTML diretto di dati API', () => {
    const js = fs.readFileSync(path.join(PUBLIC_DIR, 'js', 'monitor.js'), 'utf8');

    assert.doesNotMatch(js, /\.innerHTML\s*=/);
    assert.match(js, /textContent/);
    assert.match(js, /replaceChildren/);
});

test('monitor.js ignora risposte dettaglio diventate obsolete', () => {
    const js = fs.readFileSync(path.join(PUBLIC_DIR, 'js', 'monitor.js'), 'utf8');

    assert.match(js, /const requestedProject = state\.selectedProject/);
    assert.match(js, /state\.selectedProject !== requestedProject/);
    assert.match(js, /state\.view !== 'project-detail'/);
});

test('monitor.js usa contenuto valido e fuso Europe Rome nelle card', () => {
    const js = fs.readFileSync(path.join(PUBLIC_DIR, 'js', 'monitor.js'), 'utf8');

    assert.match(js, /createElement\('span', 'project-name'/);
    assert.match(js, /timeZone: DISPLAY_TIMEZONE/);
});

test('monitor.js renderizza log group complete e prefix come badge distinti', () => {
    const js = fs.readFileSync(path.join(PUBLIC_DIR, 'js', 'monitor.js'), 'utf8');

    assert.match(js, /renderLogGroupSummary/);
    assert.match(js, /configuredLogGroups/);
    assert.match(js, /log-group-badge/);
    assert.match(js, /Complete/);
    assert.match(js, /Prefix/);
});

test('monitor.js gestisce baseline e nuove eccezioni per progetto', () => {
    const js = fs.readFileSync(path.join(PUBLIC_DIR, 'js', 'monitor.js'), 'utf8');

    assert.match(js, /monitor\.acknowledgedExceptions/);
    assert.match(js, /loadAcknowledgedExceptions/);
    assert.match(js, /saveAcknowledgedExceptions/);
    assert.match(js, /hasUnreadException/);
    assert.match(js, /acknowledgeProjectExceptions/);
    assert.match(js, /has-unread-exception/);
    assert.match(js, /Nuova eccezione/);
});

test('monitor.js riconosce la card prima di aprire il dettaglio', () => {
    const js = fs.readFileSync(path.join(PUBLIC_DIR, 'js', 'monitor.js'), 'utf8');
    const acknowledgeIndex = js.indexOf('acknowledgeProjectExceptions(project)');
    const detailIndex = js.indexOf('showProjectDetail(project.id)');

    assert.ok(acknowledgeIndex >= 0);
    assert.ok(detailIndex > acknowledgeIndex);
});

test('monitor.css definisce griglia card, focus e layout responsive', () => {
    const css = fs.readFileSync(path.join(PUBLIC_DIR, 'css', 'monitor.css'), 'utf8');

    assert.match(css, /\.project-grid/);
    assert.match(css, /\.project-card/);
    assert.match(css, /:focus-visible/);
    assert.match(css, /@media \(max-width: 900px\)/);
    assert.match(css, /\.project-card\.has-unread-exception/);
    assert.match(css, /\.log-group-summary/);
    assert.match(css, /\.log-group-badge\.is-prefix/);
    assert.match(css, /\.log-group-badge\.is-complete/);
    assert.match(css, /prefers-reduced-motion/);
});
