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
