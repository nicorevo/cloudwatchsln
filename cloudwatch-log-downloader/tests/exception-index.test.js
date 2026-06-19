const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const ExceptionIndex = require('../src/monitor/exception-index');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'logs');
const FILE_PREFIX = 'my-app-logs-prod';
const MONITOR_CONFIG = {
    maxExceptionFiles: 50
};

test('buildTree returns files and exception leaves', async () => {
    const index = new ExceptionIndex(MONITOR_CONFIG, FILE_PREFIX, FIXTURE_DIR);
    const tree = await index.buildTree();

    assert.ok(tree.files.length >= 1);
    const fixtureFile = tree.files.find(file => file.id === 'fixture');
    assert.ok(fixtureFile);
    assert.equal(fixtureFile.exceptionCount, 2);
    assert.equal(fixtureFile.exceptions[0].id, 'fixture:1');
    assert.equal(fixtureFile.exceptions[1].lineNumberInMain, 15);
});
