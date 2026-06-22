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
});

test('monitor.js evita rendering HTML diretto di dati API', () => {
    const js = fs.readFileSync(path.join(PUBLIC_DIR, 'js', 'monitor.js'), 'utf8');

    assert.doesNotMatch(js, /\.innerHTML\s*=/);
    assert.match(js, /textContent/);
    assert.match(js, /replaceChildren/);
});

test('monitor.css definisce griglia card, focus e layout responsive', () => {
    const css = fs.readFileSync(path.join(PUBLIC_DIR, 'css', 'monitor.css'), 'utf8');

    assert.match(css, /\.project-grid/);
    assert.match(css, /\.project-card/);
    assert.match(css, /:focus-visible/);
    assert.match(css, /@media \(max-width: 900px\)/);
});
