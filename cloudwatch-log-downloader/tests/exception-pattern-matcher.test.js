const test = require('node:test');
const assert = require('node:assert/strict');

const {
    normalizePatterns,
    isExceptionMessage
} = require('../src/exception-pattern-matcher');

test('include senza exclude classifica il messaggio come eccezione', () => {
    assert.equal(
        isExceptionMessage('ERROR database unavailable', ['ERROR'], []),
        true
    );
});

test('exclude prevale quando il messaggio soddisfa anche un include', () => {
    assert.equal(
        isExceptionMessage(
            'ERROR Known harmless error',
            ['ERROR'],
            ['Known harmless error']
        ),
        false
    );
});

test('solo exclude o nessun pattern non produce una eccezione', () => {
    assert.equal(isExceptionMessage('Known harmless error', [], ['Known']), false);
    assert.equal(isExceptionMessage('ERROR failure', [], []), false);
});

test('matching è case-sensitive e basato su sottostringa', () => {
    assert.equal(isExceptionMessage('error failure', ['ERROR'], []), false);
    assert.equal(isExceptionMessage('prefix ERROR suffix', ['ERROR'], []), true);
});

test('pattern generico error non matcha parole italiane come errore', () => {
    assert.equal(
        isExceptionMessage(
            'INFO Messaggio mail: e presente un errore nella definizione',
            ['error'],
            []
        ),
        false
    );
    assert.equal(isExceptionMessage('INFO ERRORE nel corpo mail', ['ERROR'], []), false);
    assert.equal(isExceptionMessage('worker error: timeout', ['error'], []), true);
    assert.equal(isExceptionMessage('worker ERROR: timeout', ['ERROR'], []), true);
    assert.equal(isExceptionMessage('[error] timeout', ['error'], []), true);
});

test('pattern vuoti e non stringa sono ignorati senza mutare input', () => {
    const patterns = ['', null, 42, 'ERROR'];
    const normalized = normalizePatterns(patterns);

    assert.deepEqual(normalized, ['ERROR']);
    assert.deepEqual(patterns, ['', null, 42, 'ERROR']);
    assert.equal(isExceptionMessage('ERROR failure', patterns, ['', null]), true);
});

test('messaggi nullish non generano errori', () => {
    assert.equal(isExceptionMessage(null, ['ERROR'], []), false);
    assert.equal(isExceptionMessage(undefined, ['ERROR'], []), false);
});
