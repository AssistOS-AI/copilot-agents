import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';

const SESSION_EXPIRY_MS = 30 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;

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

function safeUserId(raw) {
    return String(raw || 'anonymous').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 128);
}

function safeProvider(raw) {
    return String(raw || 'chatgpt').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64);
}

export class BrowserSessionManager {
    constructor(options = {}) {
        this._dataDir = options.dataDir || '/data';
        this._headlessMode = options.headlessMode || 'new';
        this._executablePath = options.executablePath || null;
        this._sessions = new Map();
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
            createdAt: now,
            updatedAt: now,
            browser: null,
            context: null,
            page: null,
            screenshot: null,
            error: null,
            continuationPromise: null,
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
    }

    async launchBrowser(session) {
        const profilePath = this.profileDir(session.ownerUserId, session.provider);
        fs.mkdirSync(profilePath, { recursive: true });

        let playwright;
        try {
            playwright = await import('playwright-core');
        } catch {
            this._updateState(session, 'failed');
            session.error = 'playwright-core is not available';
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
            session.error = `Browser launch failed: ${err.message}`;
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
            session.error = `Navigation failed: ${err.message}`;
        }
    }

    async detectLoginRequired(session, provider) {
        if (!session.page) return false;
        try {
            const url = session.page.url();
            if (provider === 'chatgpt') {
                const hasLoginButton = await session.page.locator(
                    'button:has-text("Log in"), a:has-text("Log in"), [data-testid="login-button"]',
                ).count().catch(() => 0);
                const isAuthPage = url.includes('auth0.com')
                    || url.includes('/auth/login')
                    || url.includes('login.openai.com');
                return hasLoginButton > 0 || isAuthPage;
            }
            if (provider === 'gemini') {
                const hasSignInButton = await session.page.locator(
                    'a:has-text("Sign in"), button:has-text("Sign in"), a[href*="accounts.google.com"]',
                ).count().catch(() => 0);
                const isAuthPage = url.includes('accounts.google.com')
                    || url.includes('/signin/')
                    || url.includes('/ServiceLogin');
                return hasSignInButton > 0 || isAuthPage;
            }
            return false;
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

    startContinuation(session) {
        if (session.state === 'waiting_for_user') {
            this._updateState(session, 'running');
        }
        if (session.state !== 'running') {
            return { ok: false, error: `cannot continue from state ${session.state}` };
        }
        if (!session.continuationPromise) {
            session.continuationPromise = this.submitPrompt(session, session.prompt)
                .catch((err) => {
                    this._updateState(session, 'failed');
                    session.error = `Task execution failed: ${err.message || String(err)}`;
                    return { ok: false, final_answer: '', error: session.error };
                })
                .finally(() => {
                    session.continuationPromise = null;
                });
        }
        return { ok: true, state: session.state };
    }

    async continueAfterUserReady(session) {
        const started = this.startContinuation(session);
        if (!started.ok) {
            return { ok: false, final_answer: '', error: started.error };
        }
        return await session.continuationPromise;
    }

    async submitPrompt(session, prompt) {
        if (session.provider === 'gemini') {
            return await this.submitPromptToGemini(session, prompt);
        }
        return await this.submitPromptToChatGPT(session, prompt);
    }

    async submitPromptToChatGPT(session, prompt) {
        if (!session.page) {
            this._updateState(session, 'failed');
            session.error = 'no active page';
            return { ok: false, final_answer: '', error: 'no active page' };
        }

        this._updateState(session, 'running');

        try {
            const composer = session.page.locator(
                '#prompt-textarea, [contenteditable="true"][data-placeholder], textarea[placeholder*="Message"]',
            ).first();
            await composer.waitFor({ state: 'visible', timeout: 15000 });
            await composer.click();
            await composer.fill(prompt);

            const sendButton = session.page.locator(
                'button[data-testid="send-button"], button[aria-label="Send prompt"]',
            ).first();
            await sendButton.click();

            await session.page.waitForTimeout(3000);

            const responseSelector = '[data-message-author-role="assistant"]:last-of-type, .agent-turn:last-of-type .markdown';
            await session.page.waitForSelector(responseSelector, { timeout: 120000 });

            await this._waitForResponseComplete(session);

            const answer = await this._extractLastResponse(session);
            this._updateState(session, 'completed');
            return { ok: true, final_answer: answer };
        } catch (err) {
            this._updateState(session, 'failed');
            session.error = `Task execution failed: ${err.message}`;
            return { ok: false, final_answer: '', error: err.message };
        }
    }

    async submitPromptToGemini(session, prompt) {
        if (!session.page) {
            this._updateState(session, 'failed');
            session.error = 'no active page';
            return { ok: false, final_answer: '', error: 'no active page' };
        }

        this._updateState(session, 'running');

        try {
            const composer = session.page.locator(
                'rich-textarea [contenteditable="true"], div[contenteditable="true"][aria-label*="Enter"], textarea',
            ).first();
            await composer.waitFor({ state: 'visible', timeout: 15000 });
            await composer.click();
            await session.page.keyboard.type(prompt);
            await session.page.keyboard.press('Enter');

            await session.page.waitForTimeout(3000);

            const responseSelector = 'message-content, .model-response-text, response-container, [data-response-index]';
            await session.page.waitForSelector(responseSelector, { timeout: 120000 });

            await this._waitForGeminiResponseComplete(session);

            const answer = await this._extractLastGeminiResponse(session);
            this._updateState(session, 'completed');
            return { ok: true, final_answer: answer };
        } catch (err) {
            this._updateState(session, 'failed');
            session.error = `Task execution failed: ${err.message}`;
            return { ok: false, final_answer: '', error: err.message };
        }
    }

    async _waitForResponseComplete(session) {
        const maxWait = 120000;
        const pollInterval = 2000;
        let elapsed = 0;
        let previousText = '';

        while (elapsed < maxWait) {
            await session.page.waitForTimeout(pollInterval);
            elapsed += pollInterval;

            const currentText = await this._extractLastResponse(session);
            const stillStreaming = await session.page.locator(
                'button[aria-label="Stop generating"], .result-streaming',
            ).count().catch(() => 0);

            if (stillStreaming === 0 && currentText === previousText && currentText.length > 0) {
                break;
            }
            previousText = currentText;
        }
    }

    async _extractLastResponse(session) {
        try {
            const messages = await session.page.locator(
                '[data-message-author-role="assistant"]',
            ).all();
            if (messages.length === 0) return '';
            const last = messages[messages.length - 1];
            const text = await last.innerText();
            return text.trim();
        } catch {
            return '';
        }
    }

    async _waitForGeminiResponseComplete(session) {
        const maxWait = 120000;
        const pollInterval = 2000;
        let elapsed = 0;
        let previousText = '';

        while (elapsed < maxWait) {
            await session.page.waitForTimeout(pollInterval);
            elapsed += pollInterval;

            const currentText = await this._extractLastGeminiResponse(session);
            const stillStreaming = await session.page.locator(
                'button[aria-label*="Stop"], mat-progress-bar, .loading',
            ).count().catch(() => 0);

            if (stillStreaming === 0 && currentText === previousText && currentText.length > 0) {
                break;
            }
            previousText = currentText;
        }
    }

    async _extractLastGeminiResponse(session) {
        try {
            const messages = await session.page.locator(
                'message-content, .model-response-text, response-container, [data-response-index]',
            ).all();
            if (messages.length === 0) return '';
            const last = messages[messages.length - 1];
            const text = await last.innerText();
            return text.trim();
        } catch {
            return '';
        }
    }

    async closeSession(sessionId) {
        const session = this._sessions.get(sessionId);
        if (!session) return { ok: false, error: 'session not found' };
        this._closeSessionResources(session);
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
        if (session.context) {
            session.context.close().catch(() => {});
            session.context = null;
            session.browser = null;
            session.page = null;
        }
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
