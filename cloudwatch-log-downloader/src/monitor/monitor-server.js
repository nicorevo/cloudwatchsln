const http = require('http');
const fs = require('fs-extra');
const path = require('path');
const { URL } = require('url');

const ExceptionIndex = require('./exception-index');
const ExceptionContext = require('./exception-context');

const LEGACY_GONE_HINT = 'Usa GET /api/v1/projects/{project}/exceptions/tree';

class MonitorServer {
    constructor(config, logger, projects) {
        this.config = config;
        this.logger = logger;
        this.publicDirectory = path.join(__dirname, '..', '..', 'public');
        this.server = null;
        this.projects = this.buildProjectRegistry(projects);
    }

    buildProjectRegistry(projects) {
        const registry = new Map();

        for (const projectConfig of projects || []) {
            registry.set(projectConfig.project, {
                project: projectConfig.project,
                filePrefix: projectConfig.filePrefix,
                logDirectory: projectConfig.logDirectory,
                logDirectoryDisplay: projectConfig.logDirectoryDisplay
                    || path.basename(projectConfig.logDirectory),
                exceptionIndex: new ExceptionIndex(
                    this.config,
                    projectConfig.filePrefix,
                    projectConfig.logDirectory
                ),
                exceptionContext: new ExceptionContext(
                    this.config,
                    projectConfig.filePrefix,
                    projectConfig.logDirectory
                )
            });
        }

        return registry;
    }

    resolveProject(projectId) {
        return this.projects.get(projectId) || null;
    }

    async start() {
        if (!this.config.enabled) {
            return;
        }

        await new Promise((resolve, reject) => {
            this.server = http.createServer((req, res) => {
                this.handleRequest(req, res).catch(error => {
                    this.logger.error('Monitor request error:', error.message);
                    this.sendJson(res, 500, {
                        error: 'Internal monitor error',
                        code: 'INTERNAL_ERROR'
                    });
                });
            });

            this.server.on('error', reject);
            this.server.listen(this.config.port, this.config.host, () => {
                this.logger.info('Exception monitor started', {
                    url: `http://${this.config.host}:${this.config.port}`,
                    projectCount: this.projects.size
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
                error: 'Method not allowed',
                code: 'METHOD_NOT_ALLOWED'
            });
        }

        if (pathname === '/api/v1/projects') {
            return this.handleProjectsList(res);
        }

        if (pathname === '/api/v1/health') {
            return this.handleGlobalHealth(res);
        }

        const projectHealthMatch = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/health$/);
        if (projectHealthMatch) {
            return this.handleProjectHealth(res, decodeURIComponent(projectHealthMatch[1]));
        }

        const projectTreeMatch = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/exceptions\/tree$/);
        if (projectTreeMatch) {
            return this.handleTree(res, decodeURIComponent(projectTreeMatch[1]), requestUrl);
        }

        const projectExceptionMatch = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/exceptions\/([^/]+)$/);
        if (projectExceptionMatch) {
            return this.handleExceptionDetail(
                res,
                decodeURIComponent(projectExceptionMatch[1]),
                decodeURIComponent(projectExceptionMatch[2])
            );
        }

        if (pathname === '/api/v1/exceptions/tree') {
            return this.sendLegacyGone(res);
        }

        const legacyExceptionMatch = pathname.match(/^\/api\/v1\/exceptions\/([^/]+)$/);
        if (legacyExceptionMatch) {
            return this.sendLegacyGone(res);
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
            error: 'Resource not found',
            code: 'NOT_FOUND'
        });
    }

    sendLegacyGone(res) {
        return this.sendJson(res, 410, {
            error: 'Endpoint deprecato',
            code: 'GONE',
            hint: LEGACY_GONE_HINT
        });
    }

    sendProjectNotFound(res, projectId) {
        return this.sendJson(res, 404, {
            error: 'Progetto non trovato',
            code: 'PROJECT_NOT_FOUND',
            project: projectId
        });
    }

    handleProjectsList(res) {
        return this.sendJson(res, 200, {
            generatedAt: new Date().toISOString(),
            projects: [...this.projects.values()].map(project => ({
                id: project.project,
                filePrefix: project.filePrefix,
                logDirectory: project.logDirectoryDisplay
            }))
        });
    }

    async handleGlobalHealth(res) {
        const projects = [];

        for (const project of this.projects.values()) {
            projects.push({
                id: project.project,
                exceptionFileCount: await project.exceptionIndex.countExceptionFiles()
            });
        }

        return this.sendJson(res, 200, {
            status: 'ok',
            monitorEnabled: this.config.enabled,
            projectCount: projects.length,
            projects
        });
    }

    async handleProjectHealth(res, projectId) {
        const project = this.resolveProject(projectId);
        if (!project) {
            return this.sendProjectNotFound(res, projectId);
        }

        const exceptionFileCount = await project.exceptionIndex.countExceptionFiles();

        return this.sendJson(res, 200, {
            status: 'ok',
            project: project.project,
            monitorEnabled: this.config.enabled,
            logDirectory: project.logDirectoryDisplay,
            filePrefix: project.filePrefix,
            exceptionFileCount,
            treeRefreshSeconds: this.config.treeRefreshSeconds
        });
    }

    async handleTree(res, projectId, requestUrl) {
        const project = this.resolveProject(projectId);
        if (!project) {
            return this.sendProjectNotFound(res, projectId);
        }

        const limitParam = requestUrl.searchParams.get('limit');
        const limit = limitParam ? Number.parseInt(limitParam, 10) : null;
        const tree = await project.exceptionIndex.buildTree(limit);

        return this.sendJson(res, 200, {
            ...tree,
            project: project.project
        });
    }

    async handleExceptionDetail(res, projectId, exceptionId) {
        const project = this.resolveProject(projectId);
        if (!project) {
            return this.sendProjectNotFound(res, projectId);
        }

        try {
            const detail = await project.exceptionContext.resolveExceptionContext(exceptionId);
            return this.sendJson(res, 200, {
                ...detail,
                project: project.project
            });
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
                error: 'Resource not found',
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
