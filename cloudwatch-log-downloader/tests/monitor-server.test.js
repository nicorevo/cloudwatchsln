const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');

const MonitorServer = require('../src/monitor/monitor-server');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'logs');
const FILE_PREFIX = 'my-app-logs-prod';
const logger = {
    info() {},
    error() {}
};

test('monitor server exposes health tree and detail endpoints', async () => {
    const config = {
        enabled: true,
        host: '127.0.0.1',
        port: 0,
        contextLinesBefore: 10,
        contextLinesAfter: 10,
        treeRefreshSeconds: 30,
        maxExceptionFiles: 50
    };

    const server = new MonitorServer(config, logger, FILE_PREFIX, FIXTURE_DIR);
    await server.start();

    const address = server.server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
        const health = await requestJson(`${baseUrl}/api/v1/health`);
        assert.equal(health.status, 'ok');
        assert.equal(health.exceptionFileCount, 2);

        const tree = await requestJson(`${baseUrl}/api/v1/exceptions/tree`);
        const fixtureFile = tree.files.find(file => file.id === 'fixture');
        assert.ok(fixtureFile);
        assert.equal(fixtureFile.exceptions[0].id, 'fixture:1');

        const detail = await requestJson(`${baseUrl}/api/v1/exceptions/fixture:2`);
        assert.equal(detail.exception.lineNumberInMain, 15);
    } finally {
        await server.stop();
    }
});

test('monitor server returns 400 for invalid exception id', async () => {
    const server = await startServerOnRandomPort();

    try {
        const response = await request(`${server.baseUrl}/api/v1/exceptions/not-valid`);
        assert.equal(response.statusCode, 400);
        assert.equal(response.body.code, 'INVALID_ID');
    } finally {
        await server.stop();
    }
});

test('monitor server returns 404 for unknown exception id', async () => {
    const server = await startServerOnRandomPort();

    try {
        const response = await request(`${server.baseUrl}/api/v1/exceptions/fixture:99`);
        assert.equal(response.statusCode, 404);
        assert.equal(response.body.code, 'NOT_FOUND');
    } finally {
        await server.stop();
    }
});

test('monitor server serves frontend index.html', async () => {
    const server = await startServerOnRandomPort();

    try {
        const response = await request(`${server.baseUrl}/`);
        assert.equal(response.statusCode, 200);
        assert.match(response.body, /Exception Monitor/);
    } finally {
        await server.stop();
    }
});

test('monitor server returns 400 for path traversal exception id', async () => {
    const server = await startServerOnRandomPort();
    const maliciousId = `${encodeURIComponent('../../../etc/passwd')}:1`;

    try {
        const response = await request(`${server.baseUrl}/api/v1/exceptions/${maliciousId}`);
        assert.equal(response.statusCode, 400);
        assert.equal(response.body.code, 'INVALID_ID');
    } finally {
        await server.stop();
    }
});

test('monitor server health returns configured log directory display path', async () => {
    const config = {
        enabled: true,
        host: '127.0.0.1',
        port: 0,
        contextLinesBefore: 10,
        contextLinesAfter: 10,
        treeRefreshSeconds: 30,
        maxExceptionFiles: 50
    };

    const server = new MonitorServer(config, logger, FILE_PREFIX, FIXTURE_DIR, './logs');
    await server.start();
    const baseUrl = `http://127.0.0.1:${server.server.address().port}`;

    try {
        const health = await requestJson(`${baseUrl}/api/v1/health`);
        assert.equal(health.logDirectory, './logs');
    } finally {
        await server.stop();
    }
});

test('monitor server does not listen when disabled', async () => {
    const config = {
        enabled: false,
        host: '127.0.0.1',
        port: 0,
        contextLinesBefore: 10,
        contextLinesAfter: 10,
        treeRefreshSeconds: 30,
        maxExceptionFiles: 50
    };

    const server = new MonitorServer(config, logger, FILE_PREFIX, FIXTURE_DIR);
    await server.start();

    assert.equal(server.server, null);
});

async function startServerOnRandomPort() {
    const config = {
        enabled: true,
        host: '127.0.0.1',
        port: 0,
        contextLinesBefore: 10,
        contextLinesAfter: 10,
        treeRefreshSeconds: 30,
        maxExceptionFiles: 50
    };

    const server = new MonitorServer(config, logger, FILE_PREFIX, FIXTURE_DIR);
    await server.start();
    const address = server.server.address();

    return {
        baseUrl: `http://127.0.0.1:${address.port}`,
        stop: () => server.stop()
    };
}

function request(url) {
    return new Promise((resolve, reject) => {
        http.get(url, response => {
            let body = '';

            response.on('data', chunk => {
                body += chunk;
            });

            response.on('end', () => {
                const contentType = response.headers['content-type'] || '';
                resolve({
                    statusCode: response.statusCode,
                    body: contentType.includes('json') ? JSON.parse(body) : body
                });
            });
        }).on('error', reject);
    });
}

function requestJson(url) {
    return request(url).then(response => {
        if (response.statusCode !== 200) {
            throw new Error(`Unexpected status ${response.statusCode}`);
        }

        return response.body;
    });
}
