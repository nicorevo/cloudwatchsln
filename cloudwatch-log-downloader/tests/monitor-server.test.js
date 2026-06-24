const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs-extra');
const http = require('http');
const os = require('os');
const path = require('path');

const MonitorServer = require('../src/monitor/monitor-server');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'logs');
const FILE_PREFIX = 'my-app-logs-prod';
const OTHER_PREFIX = 'other-service-logs-prod';
const logger = {
    info() {},
    error() {}
};

const MONITOR_CONFIG = {
    enabled: true,
    host: '127.0.0.1',
    port: 0,
    contextLinesBefore: 10,
    contextLinesAfter: 10,
    treeRefreshSeconds: 30,
    maxExceptionFiles: 50
};

function singleProject(projects = []) {
    if (projects.length > 0) {
        return projects;
    }

    return [{
        project: 'my-app',
        filePrefix: FILE_PREFIX,
        logDirectory: FIXTURE_DIR,
        logDirectoryDisplay: './logs',
        configuredLogGroups: [
            { type: 'complete', value: '/eks/ns/static-worker-prod' },
            { type: 'prefix', value: '/eks/ns/generated-worker-' }
        ],
        resolvedLogGroups: [
            '/eks/ns/static-worker-prod',
            '/eks/ns/generated-worker-001',
            '/eks/ns/generated-worker-002'
        ]
    }];
}

test('monitor server espone health tree e detail per progetto', async () => {
    const server = new MonitorServer(MONITOR_CONFIG, logger, singleProject());
    await server.start();
    const baseUrl = `http://127.0.0.1:${server.server.address().port}`;

    try {
        const health = await requestJson(`${baseUrl}/api/v1/projects/my-app/health`);
        assert.equal(health.status, 'ok');
        assert.equal(health.project, 'my-app');
        assert.equal(health.exceptionFileCount, 2);

        const tree = await requestJson(`${baseUrl}/api/v1/projects/my-app/exceptions/tree`);
        assert.equal(tree.project, 'my-app');
        const fixtureFile = tree.files.find(file => file.id === 'fixture');
        assert.ok(fixtureFile);
        assert.equal(fixtureFile.exceptions[0].id, 'fixture:1');

        const detail = await requestJson(`${baseUrl}/api/v1/projects/my-app/exceptions/fixture:2`);
        assert.equal(detail.project, 'my-app');
        assert.equal(detail.exception.lineNumberInMain, 15);
    } finally {
        await server.stop();
    }
});

test('monitor server espone lista progetti', async () => {
    const server = new MonitorServer(MONITOR_CONFIG, logger, singleProject());
    await server.start();
    const baseUrl = `http://127.0.0.1:${server.server.address().port}`;

    try {
        const projects = await requestJson(`${baseUrl}/api/v1/projects`);
        assert.equal(projects.projects.length, 1);
        assert.equal(projects.projects[0].id, 'my-app');
        assert.equal(projects.projects[0].filePrefix, FILE_PREFIX);
        assert.deepEqual(projects.projects[0].configuredLogGroups, [
            { type: 'complete', value: '/eks/ns/static-worker-prod' },
            { type: 'prefix', value: '/eks/ns/generated-worker-' }
        ]);
        assert.deepEqual(projects.projects[0].resolvedLogGroups, [
            '/eks/ns/static-worker-prod',
            '/eks/ns/generated-worker-001',
            '/eks/ns/generated-worker-002'
        ]);
        assert.equal(projects.projects[0].exceptionPatterns, undefined);
        assert.equal(projects.projects[0].excludeExceptionPatterns, undefined);
    } finally {
        await server.stop();
    }
});

test('monitor server espone initial e incremental tail per progetto', async () => {
    const logDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'monitor-tail-'));
    const filename = 'tail-service_2026-06-23_10-00.log';
    await fs.writeFile(
        path.join(logDirectory, filename),
        '[2026-06-23T08:00:00.000Z] [group | api] initial\n'
    );

    const server = new MonitorServer(MONITOR_CONFIG, logger, [{
        project: 'tail-service',
        filePrefix: 'tail-service',
        logDirectory,
        logDirectoryDisplay: './logs',
        exceptionPatterns: ['ERROR']
    }]);
    await server.start();
    const baseUrl = `http://127.0.0.1:${server.server.address().port}`;

    try {
        const initial = await requestJson(
            `${baseUrl}/api/v1/projects/tail-service/tail?limit=20`
        );
        assert.equal(initial.project, 'tail-service');
        assert.equal(initial.lines.length, 1);
        assert.equal(initial.lines[0].message, 'initial');

        await fs.appendFile(
            path.join(logDirectory, filename),
            '[2026-06-23T08:00:01.000Z] [group | api] ERROR appended\n'
        );

        const incremental = await requestJson(
            `${baseUrl}/api/v1/projects/tail-service/tail?limit=20&after=${encodeURIComponent(initial.cursor)}`
        );
        assert.equal(incremental.lines.length, 1);
        assert.equal(incremental.lines[0].message, 'ERROR appended');
        assert.equal(incremental.lines[0].isException, true);
    } finally {
        await server.stop();
        await fs.remove(logDirectory);
    }
});

test('monitor server valida limit e cursore tail', async () => {
    const server = await startServerOnRandomPort();

    try {
        const invalidLimit = await request(
            `${server.baseUrl}/api/v1/projects/my-app/tail?limit=10`
        );
        assert.equal(invalidLimit.statusCode, 400);
        assert.equal(invalidLimit.body.code, 'INVALID_LIMIT');

        const invalidCursor = await request(
            `${server.baseUrl}/api/v1/projects/my-app/tail?after=invalid`
        );
        assert.equal(invalidCursor.statusCode, 400);
        assert.equal(invalidCursor.body.code, 'INVALID_CURSOR');
    } finally {
        await server.stop();
    }
});

test('monitor server applica exclude per progetto a dashboard, health, tree, detail e tail', async () => {
    const logDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'monitor-exclude-'));
    const prefix = 'filtered-service';
    const fileId = '2026-06-23_10-00';

    await fs.writeFile(
        path.join(logDirectory, `${prefix}-exceptions_${fileId}.log`),
        [
            '[2026-06-23T08:00:00.000Z] [group | api] ERROR first',
            '[2026-06-23T08:01:00.000Z] [group | api] ERROR Known harmless error',
            '[2026-06-23T08:02:00.000Z] [group | api] ERROR third'
        ].join('\n')
    );
    await fs.writeFile(
        path.join(logDirectory, `${prefix}_${fileId}.log`),
        [
            '[2026-06-23T08:00:00.000Z] [group | api] ERROR first',
            '[2026-06-23T08:01:00.000Z] [group | api] ERROR Known harmless error',
            '[2026-06-23T08:02:00.000Z] [group | api] ERROR third'
        ].join('\n') + '\n'
    );

    const server = new MonitorServer(MONITOR_CONFIG, logger, [{
        project: 'filtered-service',
        filePrefix: prefix,
        logDirectory,
        logDirectoryDisplay: './logs',
        exceptionPatterns: ['ERROR'],
        excludeExceptionPatterns: ['Known harmless error']
    }], {
        nowProvider: () => new Date('2026-06-23T08:30:00.000Z')
    });
    await server.start();
    const baseUrl = `http://127.0.0.1:${server.server.address().port}`;

    try {
        const dashboard = await requestJson(`${baseUrl}/api/v1/dashboard`);
        assert.equal(dashboard.projects[0].metrics.retainedExceptionCount, 2);
        assert.equal(dashboard.projects[0].metrics.exceptionFileCount, 1);

        const health = await requestJson(
            `${baseUrl}/api/v1/projects/filtered-service/health`
        );
        assert.equal(health.exceptionFileCount, 1);

        const tree = await requestJson(
            `${baseUrl}/api/v1/projects/filtered-service/exceptions/tree`
        );
        assert.deepEqual(
            tree.files[0].exceptions.map(exception => exception.id),
            [`${fileId}:1`, `${fileId}:3`]
        );

        const excludedDetail = await request(
            `${baseUrl}/api/v1/projects/filtered-service/exceptions/${fileId}:2`
        );
        assert.equal(excludedDetail.statusCode, 404);
        assert.equal(excludedDetail.body.code, 'NOT_FOUND');

        const tail = await requestJson(
            `${baseUrl}/api/v1/projects/filtered-service/tail?limit=20`
        );
        assert.deepEqual(
            tail.lines.map(line => line.isException),
            [true, false, true]
        );
    } finally {
        await server.stop();
        await fs.remove(logDirectory);
    }
});

test('monitor server isola tail tra progetti nella stessa directory', async () => {
    const server = new MonitorServer(MONITOR_CONFIG, logger, singleProject([
        {
            project: 'my-app',
            filePrefix: FILE_PREFIX,
            logDirectory: FIXTURE_DIR,
            logDirectoryDisplay: './logs',
            exceptionPatterns: ['ERROR']
        },
        {
            project: 'other-service',
            filePrefix: OTHER_PREFIX,
            logDirectory: FIXTURE_DIR,
            logDirectoryDisplay: './logs',
            exceptionPatterns: ['Exception']
        }
    ]));
    await server.start();
    const baseUrl = `http://127.0.0.1:${server.server.address().port}`;

    try {
        const first = await requestJson(
            `${baseUrl}/api/v1/projects/my-app/tail?limit=20`
        );
        assert.ok(first.lines.every(line => !line.raw.includes('other-service')));

        const second = await requestJson(
            `${baseUrl}/api/v1/projects/other-service/tail?limit=20`
        );
        assert.ok(second.lines.every(line => !line.raw.includes(FILE_PREFIX)));
    } finally {
        await server.stop();
    }
});

test('monitor server espone health globale aggregato', async () => {
    const server = new MonitorServer(MONITOR_CONFIG, logger, singleProject());
    await server.start();
    const baseUrl = `http://127.0.0.1:${server.server.address().port}`;

    try {
        const health = await requestJson(`${baseUrl}/api/v1/health`);
        assert.equal(health.status, 'ok');
        assert.equal(health.projectCount, 1);
        assert.equal(health.projects[0].id, 'my-app');
        assert.equal(health.projects[0].exceptionFileCount, 2);
    } finally {
        await server.stop();
    }
});

test('monitor server espone dashboard aggregata ordinata per attività recente', async () => {
    const logDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'monitor-dashboard-'));
    const now = new Date('2026-06-22T12:00:00.000Z');

    await fs.writeFile(
        path.join(logDirectory, 'active-service-exceptions_recent.log'),
        [
            '[2026-06-22T11:30:00.000Z] [/eks/example | worker] ERROR recent',
            '[2026-06-22T09:00:00.000Z] [/eks/example | worker] ERROR older'
        ].join('\n')
    );
    await fs.writeFile(
        path.join(logDirectory, 'recent-service-exceptions_today.log'),
        '[2026-06-22T10:00:00.000Z] [/eks/example | api] ERROR today'
    );

    const server = new MonitorServer(MONITOR_CONFIG, logger, [
        {
            project: 'recent-service',
            filePrefix: 'recent-service',
            logDirectory,
            logDirectoryDisplay: './logs'
        },
        {
            project: 'empty-service',
            filePrefix: 'empty-service',
            logDirectory,
            logDirectoryDisplay: './logs'
        },
        {
            project: 'active-service',
            filePrefix: 'active-service',
            logDirectory,
            logDirectoryDisplay: './logs'
        }
    ], {
        nowProvider: () => now
    });
    await server.start();
    const baseUrl = `http://127.0.0.1:${server.server.address().port}`;

    try {
        const dashboard = await requestJson(`${baseUrl}/api/v1/dashboard`);

        assert.equal(dashboard.timezone, 'Europe/Rome');
        assert.equal(dashboard.refreshSeconds, 30);
        assert.equal(dashboard.projectCount, 3);
        assert.deepEqual(
            dashboard.projects.map(project => project.id),
            ['active-service', 'recent-service', 'empty-service']
        );

        assert.deepEqual(dashboard.projects[0], {
            id: 'active-service',
            status: 'active',
            configuredLogGroups: [],
            resolvedLogGroups: [],
            metrics: {
                retainedExceptionCount: 2,
                lastHourExceptionCount: 1,
                todayExceptionCount: 2,
                exceptionFileCount: 1,
                latestExceptionAt: '2026-06-22T11:30:00.000Z'
            }
        });
        assert.equal(dashboard.projects[1].status, 'recent');
        assert.equal(dashboard.projects[2].status, 'inactive');
    } finally {
        await server.stop();
        await fs.remove(logDirectory);
    }
});

test('monitor server isola errore metriche di un progetto', async () => {
    const logDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'monitor-dashboard-ok-'));
    const missingDirectory = path.join(logDirectory, 'missing');
    const server = new MonitorServer(MONITOR_CONFIG, logger, [
        {
            project: 'healthy-service',
            filePrefix: 'healthy-service',
            logDirectory,
            logDirectoryDisplay: './logs'
        },
        {
            project: 'broken-service',
            filePrefix: 'broken-service',
            logDirectory: missingDirectory,
            logDirectoryDisplay: './missing'
        }
    ], {
        nowProvider: () => new Date('2026-06-22T12:00:00.000Z')
    });
    await server.start();
    const baseUrl = `http://127.0.0.1:${server.server.address().port}`;

    try {
        const response = await request(`${baseUrl}/api/v1/dashboard`);

        assert.equal(response.statusCode, 200);
        assert.equal(response.body.projects.length, 2);
        assert.deepEqual(response.body.projects[0], {
            id: 'healthy-service',
            status: 'inactive',
            configuredLogGroups: [],
            resolvedLogGroups: [],
            metrics: {
                retainedExceptionCount: 0,
                lastHourExceptionCount: 0,
                todayExceptionCount: 0,
                exceptionFileCount: 0,
                latestExceptionAt: null
            }
        });
        assert.deepEqual(response.body.projects[1], {
            id: 'broken-service',
            status: 'error',
            configuredLogGroups: [],
            resolvedLogGroups: [],
            metrics: null,
            error: {
                code: 'PROJECT_METRICS_UNAVAILABLE',
                message: 'Metriche progetto non disponibili'
            }
        });
    } finally {
        await server.stop();
        await fs.remove(logDirectory);
    }
});

test('monitor server isola tree per progetto', async () => {
    const server = new MonitorServer(MONITOR_CONFIG, logger, singleProject([
        {
            project: 'my-app',
            filePrefix: FILE_PREFIX,
            logDirectory: FIXTURE_DIR,
            logDirectoryDisplay: './logs'
        },
        {
            project: 'other-service',
            filePrefix: OTHER_PREFIX,
            logDirectory: FIXTURE_DIR,
            logDirectoryDisplay: './logs'
        }
    ]));
    await server.start();
    const baseUrl = `http://127.0.0.1:${server.server.address().port}`;

    try {
        const treeA = await requestJson(`${baseUrl}/api/v1/projects/my-app/exceptions/tree`);
        assert.equal(treeA.project, 'my-app');
        assert.ok(treeA.files.every(file => file.filename.startsWith(`${FILE_PREFIX}-exceptions_`)));

        const treeB = await requestJson(`${baseUrl}/api/v1/projects/other-service/exceptions/tree`);
        assert.equal(treeB.project, 'other-service');
        assert.equal(treeB.files.length, 1);
        assert.match(treeB.files[0].filename, /other-service-logs-prod-exceptions_/);
    } finally {
        await server.stop();
    }
});

test('monitor server returns 404 for unknown project', async () => {
    const server = await startServerOnRandomPort();

    try {
        const response = await request(`${server.baseUrl}/api/v1/projects/unknown/exceptions/tree`);
        assert.equal(response.statusCode, 404);
        assert.equal(response.body.code, 'PROJECT_NOT_FOUND');
        assert.equal(response.body.project, 'unknown');
    } finally {
        await server.stop();
    }
});

test('monitor server returns 410 for legacy exception endpoints', async () => {
    const server = await startServerOnRandomPort();

    try {
        const tree = await request(`${server.baseUrl}/api/v1/exceptions/tree`);
        assert.equal(tree.statusCode, 410);
        assert.equal(tree.body.code, 'GONE');

        const detail = await request(`${server.baseUrl}/api/v1/exceptions/fixture:1`);
        assert.equal(detail.statusCode, 410);
        assert.equal(detail.body.code, 'GONE');
    } finally {
        await server.stop();
    }
});

test('monitor server returns 400 for invalid exception id', async () => {
    const server = await startServerOnRandomPort();

    try {
        const response = await request(`${server.baseUrl}/api/v1/projects/my-app/exceptions/not-valid`);
        assert.equal(response.statusCode, 400);
        assert.equal(response.body.code, 'INVALID_ID');
    } finally {
        await server.stop();
    }
});

test('monitor server returns 404 for unknown exception id', async () => {
    const server = await startServerOnRandomPort();

    try {
        const response = await request(`${server.baseUrl}/api/v1/projects/my-app/exceptions/fixture:99`);
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
        assert.match(response.body, /CloudWatch Log Downloader/);
    } finally {
        await server.stop();
    }
});

test('monitor server serves tail page', async () => {
    const server = await startServerOnRandomPort();

    try {
        const response = await request(`${server.baseUrl}/tail`);
        assert.equal(response.statusCode, 200);
        assert.match(response.body, /id="tail-viewer"/);

        const explicit = await request(`${server.baseUrl}/tail.html`);
        assert.equal(explicit.statusCode, 200);
    } finally {
        await server.stop();
    }
});

test('monitor server returns 400 for path traversal exception id', async () => {
    const server = await startServerOnRandomPort();
    const maliciousId = `${encodeURIComponent('../../../etc/passwd')}:1`;

    try {
        const response = await request(`${server.baseUrl}/api/v1/projects/my-app/exceptions/${maliciousId}`);
        assert.equal(response.statusCode, 400);
        assert.equal(response.body.code, 'INVALID_ID');
    } finally {
        await server.stop();
    }
});

test('monitor server health progetto restituisce log directory display', async () => {
    const server = new MonitorServer(MONITOR_CONFIG, logger, singleProject());
    await server.start();
    const baseUrl = `http://127.0.0.1:${server.server.address().port}`;

    try {
        const health = await requestJson(`${baseUrl}/api/v1/projects/my-app/health`);
        assert.equal(health.logDirectory, './logs');
        assert.equal(health.filePrefix, FILE_PREFIX);
    } finally {
        await server.stop();
    }
});

test('monitor server does not listen when disabled', async () => {
    const server = new MonitorServer({
        ...MONITOR_CONFIG,
        enabled: false
    }, logger, singleProject());
    await server.start();

    assert.equal(server.server, null);
});

async function startServerOnRandomPort() {
    const server = new MonitorServer(MONITOR_CONFIG, logger, singleProject());
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
