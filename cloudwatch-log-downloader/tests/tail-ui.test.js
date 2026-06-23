const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

test('tail.html contiene navigazione, selettore e controlli', () => {
    const html = fs.readFileSync(path.join(PUBLIC_DIR, 'tail.html'), 'utf8');

    assert.match(html, /href="\/"/);
    assert.match(html, /id="tail-project-select"/);
    assert.match(html, /id="tail-pause"/);
    assert.match(html, /id="tail-wrap"/);
    assert.match(html, /id="tail-clear"/);
    assert.match(html, /id="tail-follow"/);
    assert.match(html, /id="tail-viewer"/);
    assert.match(html, /role="log"/);
    assert.match(html, /aria-live="polite"/);
    assert.match(html, /\/js\/tail\.js/);
});

test('tail.js usa endpoint scoped e polling incrementale senza overlap', () => {
    const js = fs.readFileSync(path.join(PUBLIC_DIR, 'js', 'tail.js'), 'utf8');

    assert.match(js, /\/api\/v1\/projects/);
    assert.match(js, /\/tail\?limit=/);
    assert.match(js, /after=/);
    assert.match(js, /POLL_INTERVAL_MS = 2000/);
    assert.match(js, /setTimeout/);
    assert.match(js, /requestInFlight/);
    assert.match(js, /schedulePoll\(50\)/);
    assert.match(js, /generation/);
    assert.match(js, /hasMore/);
});

test('tail.js limita, deduplica e renderizza in sicurezza', () => {
    const js = fs.readFileSync(path.join(PUBLIC_DIR, 'js', 'tail.js'), 'utf8');

    assert.match(js, /MAX_VISIBLE_LINES = 1000/);
    assert.match(js, /visibleLineIds/);
    assert.match(js, /isException/);
    assert.match(js, /tail-line-exception/);
    assert.match(js, /textContent/);
    assert.match(js, /replaceChildren/);
    assert.doesNotMatch(js, /\.innerHTML\s*=/);
});

test('tail.js gestisce pausa wrap clear e follow live', () => {
    const js = fs.readFileSync(path.join(PUBLIC_DIR, 'js', 'tail.js'), 'utf8');

    assert.match(js, /togglePause/);
    assert.match(js, /toggleWrap/);
    assert.match(js, /clearViewer/);
    assert.match(js, /followLive/);
    assert.match(js, /isNearBottom/);
    assert.match(js, /autoFollow/);
});

test('monitor.css definisce viewer tail minimalista e responsive', () => {
    const css = fs.readFileSync(path.join(PUBLIC_DIR, 'css', 'monitor.css'), 'utf8');

    assert.match(css, /\.tail-page/);
    assert.match(css, /\.tail-toolbar/);
    assert.match(css, /\.tail-viewer/);
    assert.match(css, /\.tail-line-exception/);
    assert.match(css, /\.tail-viewer\.no-wrap/);
    assert.match(css, /\.tail-follow/);
    assert.match(css, /position: sticky/);
});
