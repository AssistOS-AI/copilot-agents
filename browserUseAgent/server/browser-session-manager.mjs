import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const SESSION_EXPIRY_MS = 30 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;
const DEFAULT_TASK_TIMEOUT_MS = 120000;
const MIN_TASK_TIMEOUT_MS = 1000;
const MAX_TASK_TIMEOUT_MS = 300000;

const VALID_STATES = new Set([
    'starting',
    'ready',
    'waiting_for_user',
    'running',
    'completed',
    'failed',
    'closed',
]);

const TERMINAL_STATES = new Set(['completed', 'failed', 'closed']);
const CHROMIUM_SINGLETON_FILES = [
    'SingletonCookie',
    'SingletonLock',
    'SingletonSocket',
];

function safeUserId(raw) {
    return String(raw || 'anonymous').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 128);
}

function safeProvider(raw) {
    return String(raw || 'chatgpt').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64);
}

function normalizeTaskTimeout(value) {
    if (value === undefined || value === null || value === '') return DEFAULT_TASK_TIMEOUT_MS;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return DEFAULT_TASK_TIMEOUT_MS;
    return Math.max(MIN_TASK_TIMEOUT_MS, Math.min(MAX_TASK_TIMEOUT_MS, Math.floor(numeric)));
}

function safeErrorMessage(prefix, error) {
    const message = error && error.message ? error.message : String(error || 'unknown error');
    return `${prefix}: ${message}`;
}

export class BrowserSessionManager {
    constructor(options = {}) {
        this._dataDir = options.dataDir || '/data';
        this._headlessMode = options.headlessMode || 'new';
        this._executablePath = options.executablePath || null;
        this._sessions = new Map();
        this._profileOperations = new Map();
        this._cleanupTimer = null;
    }

    start() {
        this._cleanupTimer = setInterval(() => this._cleanupExpired(), CLEANUP_INTERVAL_MS);
        this._cleanupTimer.unref();
    }

    stop() {
        if (this._cleanupTimer) {
            clearInterval(this._cleanupTimer);
            this._cleanupTimer = null;
        }
        for (const session of this._sessions.values()) {
            this._closeSessionResources(session);
        }
        this._sessions.clear();
    }

    profileDir(userId, provider) {
        return path.join(
            this._dataDir,
            'profiles',
            safeUserId(userId),
            safeProvider(provider),
        );
    }

    profileKey(userId, provider) {
        return `${safeUserId(userId)}:${safeProvider(provider)}`;
    }

    async withProfileLock(userId, provider, operation) {
        const key = this.profileKey(userId, provider);
        const previous = this._profileOperations.get(key) || Promise.resolve();
        let release;
        const operationDone = new Promise((resolve) => {
            release = resolve;
        });
        const current = previous.catch(() => {}).then(() => operationDone);
        this._profileOperations.set(key, current);

        await previous.catch(() => {});
        try {
            return await operation();
        } finally {
            release();
            if (this._profileOperations.get(key) === current) {
                this._profileOperations.delete(key);
            }
        }
    }

    async createSession(userId, provider, options = {}) {
        const sessionId = `sess_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
        const jobId = `job_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
        const now = new Date().toISOString();
        const session = {
            sessionId,
            jobId,
            ownerUserId: safeUserId(userId),
            provider: safeProvider(provider),
            state: 'starting',
            viewerUrl: `/services/browser-use/sessions/${sessionId}`,
            pageUrl: '',
            prompt: options.prompt || '',
            timeoutMs: normalizeTaskTimeout(options.timeoutMs),
            createdAt: now,
            updatedAt: now,
            browser: null,
            context: null,
            page: null,
            screenshot: null,
            error: null,
            diagnosticError: null,
            continuationPromise: null,
            resourceClosePromise: null,
        };
        this._sessions.set(sessionId, session);
        return session;
    }

    getSession(sessionId) {
        return this._sessions.get(sessionId) || null;
    }

    getSessionByJobId(jobId) {
        for (const session of this._sessions.values()) {
            if (session.jobId === jobId) return session;
        }
        return null;
    }

    getReusableSession(userId, provider) {
        const ownerUserId = safeUserId(userId);
        const normalizedProvider = safeProvider(provider);
        for (const session of this._sessions.values()) {
            if (
                session.ownerUserId === ownerUserId
                && session.provider === normalizedProvider
                && !TERMINAL_STATES.has(session.state)
            ) {
                return session;
            }
        }
        return null;
    }

    updateSessionPrompt(session, prompt, options = {}) {
        if (!session) return null;
        session.prompt = String(prompt || '');
        if (options.timeoutMs !== undefined) {
            session.timeoutMs = normalizeTaskTimeout(options.timeoutMs);
        }
        session.updatedAt = new Date().toISOString();
        return session;
    }

    async waitForProfileRelease(userId, provider) {
        const ownerUserId = safeUserId(userId);
        const normalizedProvider = safeProvider(provider);
        const pending = [];
        for (const session of this._sessions.values()) {
            if (
                session.ownerUserId === ownerUserId
                && session.provider === normalizedProvider
                && session.resourceClosePromise
            ) {
                pending.push(session.resourceClosePromise);
            }
        }
        if (pending.length > 0) {
            await Promise.allSettled(pending);
        }
    }

    getActiveSessions() {
        return Array.from(this._sessions.values()).filter(
            (s) => !TERMINAL_STATES.has(s.state),
        );
    }

    sessionCount() {
        return this._sessions.size;
    }

    activeSessionCount() {
        return this.getActiveSessions().length;
    }

    isOwner(session, userId) {
        return session && session.ownerUserId === safeUserId(userId);
    }

    _updateState(session, newState) {
        if (!VALID_STATES.has(newState)) return;
        session.state = newState;
        session.updatedAt = new Date().toISOString();
        if (TERMINAL_STATES.has(newState)) {
            this._closeSessionResources(session);
        }
    }

    _processExists(pid) {
        if (!Number.isInteger(pid) || pid <= 0) return false;
        try {
            process.kill(pid, 0);
            return true;
        } catch (err) {
            return err && err.code === 'EPERM';
        }
    }

    _isSingletonLockStale(profilePath) {
        const lockPath = path.join(profilePath, 'SingletonLock');
        let target = '';
        try {
            target = fs.readlinkSync(lockPath);
        } catch (err) {
            if (err && err.code === 'ENOENT') return false;
            return false;
        }

        const match = /^(.+)-(\d+)$/.exec(target);
        if (!match) return false;

        const [, hostname, pidText] = match;
        const pid = Number(pidText);
        if (hostname === os.hostname() && this._processExists(pid)) {
            return false;
        }
        return true;
    }

    _clearStaleProfileSingletons(profilePath) {
        if (!this._isSingletonLockStale(profilePath)) {
            return false;
        }
        for (const name of CHROMIUM_SINGLETON_FILES) {
            fs.rmSync(path.join(profilePath, name), { force: true });
        }
        return true;
    }

    async launchBrowser(session) {
        const profilePath = this.profileDir(session.ownerUserId, session.provider);
        fs.mkdirSync(profilePath, { recursive: true });
        this._clearStaleProfileSingletons(profilePath);

        let playwright;
        try {
            playwright = await import('playwright-core');
        } catch {
            this._updateState(session, 'failed');
            session.error = 'playwright-core is not available';
            session.diagnosticError = session.error;
            return session;
        }

        const launchArgs = [
            '--disable-dev-shm-usage',
            '--disable-setuid-sandbox',
            '--no-sandbox',
            '--no-first-run',
            '--disable-background-networking',
            '--disable-default-apps',
            '--disable-sync',
            '--no-default-browser-check',
        ];

        try {
            const browser = await playwright.chromium.launchPersistentContext(
                profilePath,
                {
                    headless: this._headlessMode === 'new',
                    executablePath: this._executablePath || undefined,
                    args: launchArgs,
                    ignoreDefaultArgs: ['--enable-automation'],
                    viewport: { width: 1280, height: 800 },
                },
            );
            session.browser = browser;
            session.context = browser;
            const pages = browser.pages();
            session.page = pages.length > 0 ? pages[0] : await browser.newPage();
            this._updateState(session, 'ready');
        } catch (err) {
            this._updateState(session, 'failed');
            session.error = 'browser launch failed';
            session.diagnosticError = `Browser launch failed: ${err.message}`;
        }
        return session;
    }

    async navigateTo(session, url) {
        if (!session.page) return;
        try {
            await session.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            session.pageUrl = url;
            session.updatedAt = new Date().toISOString();
        } catch (err) {
            session.error = 'navigation failed';
            session.diagnosticError = `Navigation failed: ${err.message}`;
        }
    }

    async detectLoginRequired(session, adapter, provider = session.provider) {
        if (!session.page || !adapter) return false;
        try {
            return await adapter.detectLoginRequired({
                page: session.page,
                session,
                provider,
            });
        } catch {
            return false;
        }
    }

    async takeScreenshot(session) {
        if (!session.page) return null;
        try {
            const buffer = await session.page.screenshot({
                type: 'jpeg',
                quality: 60,
                fullPage: false,
            });
            session.screenshot = buffer;
            return buffer;
        } catch {
            return null;
        }
    }

    async sendInput(session, action) {
        if (!session.page) return { ok: false, error: 'no active page' };
        try {
            switch (action.type) {
                case 'click':
                    await session.page.mouse.click(
                        Number(action.x) || 0,
                        Number(action.y) || 0,
                    );
                    break;
                case 'type':
                    await session.page.keyboard.type(String(action.text || ''));
                    break;
                case 'key':
                    await session.page.keyboard.press(String(action.key || ''));
                    break;
                case 'scroll':
                    await session.page.mouse.wheel(
                        Number(action.deltaX) || 0,
                        Number(action.deltaY) || 0,
                    );
                    break;
                default:
                    return { ok: false, error: `unknown action type: ${action.type}` };
            }
            return { ok: true };
        } catch (err) {
            return { ok: false, error: err.message };
        }
    }

    async markUserReady(session) {
        if (session.state !== 'waiting_for_user') {
            return { ok: false, error: `cannot mark ready from state ${session.state}` };
        }
        this._updateState(session, 'running');
        return { ok: true };
    }

    startContinuation(session, adapter, provider = session.provider) {
        if (session.state === 'waiting_for_user') {
            this._updateState(session, 'running');
        }
        if (session.state !== 'running') {
            return { ok: false, error: `cannot continue from state ${session.state}` };
        }
        if (!session.continuationPromise) {
            session.continuationPromise = this.submitPrompt(session, session.prompt, adapter, provider)
                .catch((err) => {
                    this._updateState(session, 'failed');
                    session.error = 'Task execution failed.';
                    session.diagnosticError = safeErrorMessage('Task execution failed', err);
                    return { ok: false, final_answer: '', error: session.error };
                })
                .finally(() => {
                    session.continuationPromise = null;
                });
        }
        return { ok: true, state: session.state };
    }

    async continueAfterUserReady(session, adapter, provider = session.provider) {
        const started = this.startContinuation(session, adapter, provider);
        if (!started.ok) {
            return { ok: false, final_answer: '', error: started.error };
        }
        return await session.continuationPromise;
    }

    async submitPrompt(session, prompt, adapter, provider = session.provider) {
        if (!session.page) {
            this._updateState(session, 'failed');
            session.error = 'no active page';
            return { ok: false, final_answer: '', error: 'no active page' };
        }
        if (!adapter) {
            this._updateState(session, 'failed');
            session.error = 'no provider adapter';
            return { ok: false, final_answer: '', error: 'no provider adapter' };
        }

        this._updateState(session, 'running');

        let result;
        try {
            result = await adapter.submitPrompt({
                page: session.page,
                session,
                provider,
                prompt,
                timeoutMs: normalizeTaskTimeout(session.timeoutMs),
            });
        } catch (err) {
            this._updateState(session, 'failed');
            session.error = 'Task execution failed.';
            session.diagnosticError = safeErrorMessage('Provider adapter failed', err);
            return { ok: false, final_answer: '', error: session.error };
        }

        if (!result || typeof result !== 'object') {
            result = {
                ok: false,
                final_answer: '',
                error: 'Provider adapter returned an invalid result.',
            };
        }

        if (result.ok) {
            this._updateState(session, 'completed');
        } else {
            this._updateState(session, 'failed');
            session.error = result.error || 'Task execution failed.';
        }
        return result;
    }

    async closeSession(sessionId) {
        const session = this._sessions.get(sessionId);
        if (!session) return { ok: false, error: 'session not found' };
        await this._closeSessionResources(session);
        this._updateState(session, 'closed');
        return { ok: true };
    }

    async clearProfile(userId, provider) {
        const profilePath = this.profileDir(userId, provider);
        try {
            fs.rmSync(profilePath, { recursive: true, force: true });
            return { ok: true };
        } catch (err) {
            return { ok: false, error: err.message };
        }
    }

    _closeSessionResources(session) {
        if (!session.context) {
            return session.resourceClosePromise || Promise.resolve();
        }
        const context = session.context;
        session.context = null;
        session.browser = null;
        session.page = null;

        let closePromise;
        closePromise = Promise.resolve()
            .then(() => context.close())
            .catch(() => {})
            .finally(() => {
                if (session.resourceClosePromise === closePromise) {
                    session.resourceClosePromise = null;
                }
            });
        session.resourceClosePromise = closePromise;
        return closePromise;
    }

    _cleanupExpired() {
        const now = Date.now();
        for (const [id, session] of this._sessions) {
            const age = now - new Date(session.createdAt).getTime();
            if (TERMINAL_STATES.has(session.state) && age > CLEANUP_INTERVAL_MS) {
                this._closeSessionResources(session);
                this._sessions.delete(id);
            } else if (age > SESSION_EXPIRY_MS) {
                this._closeSessionResources(session);
                this._updateState(session, 'closed');
                this._sessions.delete(id);
            }
        }
    }

    publicSessionView(session) {
        if (!session) return null;
        return {
            sessionId: session.sessionId,
            jobId: session.jobId,
            ownerUserId: session.ownerUserId,
            provider: session.provider,
            state: session.state,
            viewerUrl: session.viewerUrl,
            pageUrl: session.pageUrl,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            error: session.error,
        };
    }
}
