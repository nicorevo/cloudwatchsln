const http = require('http');
const fs = require('fs-extra');
const path = require('path');
const { URL } = require('url');

const ExceptionIndex = require('./exception-index');
const ExceptionContext = require('./exception-context');

class MonitorServer {
    constructor(config, logger, filePrefix, logDirectory, logDirectoryDisplay) {
        this.config = config;
        this.logger = logger;
        this.filePrefix = filePrefix;
        this.logDirectory = logDirectory;
        this.logDirectoryDisplay = logDirectoryDisplay || path.basename(logDirectory);
        this.publicDirectory = path.join(__dirname, '..', '..', 'public');
        this.server = null;
        this.exceptionIndex = new ExceptionIndex(config, filePrefix, logDirectory);
        this.exceptionContext = new ExceptionContext(config, filePrefix, logDirectory);
    }

    async start() {
        if (!this.config.enabled) {
            return;
        }

        await new Promise((resolve, reject) => {
            this.server = http.createServer((req, res) => {
                this.handleRequest(req, res).catch(error => {
                    this.logger.error('Errore request monitor:', error.message);
                    this.sendJson(res, 500, {
                        error: 'Errore interno del monitor',
                        code: 'INTERNAL_ERROR'
                    });
                });
            });

            this.server.on('error', reject);
            this.server.listen(this.config.port, this.config.host, () => {
                this.logger.info('Monitor eccezioni avviato', {
                    url: `http://${this.config.host}:${this.config.port}`
                });
                resolve();
            });
        });
    }

    async stop() {
        if (!this.server) {
            return;
        }

        await new Promise(resolve => {
            this.server.close(() => resolve());
        });
        this.server = null;
    }

    async handleRequest(req, res) {
        const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const pathname = requestUrl.pathname;

        if (req.method !== 'GET') {
            return this.sendJson(res, 405, {
                error: 'Metodo non supportato',
                code: 'METHOD_NOT_ALLOWED'
            });
        }

        if (pathname === '/api/v1/health') {
            return this.handleHealth(res);
        }

        if (pathname === '/api/v1/exceptions/tree') {
            return this.handleTree(res, requestUrl);
        }

        const exceptionMatch = pathname.match(/^\/api\/v1\/exceptions\/([^/]+)$/);
        if (exceptionMatch) {
            return this.handleExceptionDetail(res, decodeURIComponent(exceptionMatch[1]));
        }

        if (pathname === '/' || pathname === '/index.html') {
            return this.serveStaticFile(res, path.join(this.publicDirectory, 'index.html'), 'text/html; charset=utf-8');
        }

        if (pathname.startsWith('/css/') || pathname.startsWith('/js/')) {
            const relativePath = pathname.replace(/^\/(css|js)\//, '$1/');
            const absolutePath = path.join(this.publicDirectory, relativePath);
            return this.serveStaticFile(res, absolutePath, this.getContentType(absolutePath));
        }

        return this.sendJson(res, 404, {
            error: 'Risorsa non trovata',
            code: 'NOT_FOUND'
        });
    }

    async handleHealth(res) {
        const exceptionFileCount = await this.exceptionIndex.countExceptionFiles();

        return this.sendJson(res, 200, {
            status: 'ok',
            monitorEnabled: this.config.enabled,
            logDirectory: this.logDirectoryDisplay,
            exceptionFileCount,
            treeRefreshSeconds: this.config.treeRefreshSeconds
        });
    }

    async handleTree(res, requestUrl) {
        const limitParam = requestUrl.searchParams.get('limit');
        const limit = limitParam ? Number.parseInt(limitParam, 10) : null;
        const tree = await this.exceptionIndex.buildTree(limit);

        return this.sendJson(res, 200, tree);
    }

    async handleExceptionDetail(res, exceptionId) {
        try {
            const detail = await this.exceptionContext.resolveExceptionContext(exceptionId);
            return this.sendJson(res, 200, detail);
        } catch (error) {
            if (error.code === 'INVALID_ID') {
                return this.sendJson(res, 400, {
                    error: error.message,
                    code: error.code
                });
            }

            if (error.code === 'NOT_FOUND') {
                return this.sendJson(res, 404, {
                    error: error.message,
                    code: error.code
                });
            }

            throw error;
        }
    }

    async serveStaticFile(res, absolutePath, contentType) {
        const normalizedPublicDir = path.resolve(this.publicDirectory);
        const normalizedFilePath = path.resolve(absolutePath);

        if (!normalizedFilePath.startsWith(normalizedPublicDir)) {
            return this.sendJson(res, 403, {
                error: 'Accesso negato',
                code: 'FORBIDDEN'
            });
        }

        if (!await fs.pathExists(normalizedFilePath)) {
            return this.sendJson(res, 404, {
                error: 'Risorsa non trovata',
                code: 'NOT_FOUND'
            });
        }

        const content = await fs.readFile(normalizedFilePath);
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
    }

    getContentType(filePath) {
        if (filePath.endsWith('.css')) {
            return 'text/css; charset=utf-8';
        }

        if (filePath.endsWith('.js')) {
            return 'application/javascript; charset=utf-8';
        }

        return 'text/plain; charset=utf-8';
    }

    sendJson(res, statusCode, payload) {
        res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
    }
}

module.exports = MonitorServer;
