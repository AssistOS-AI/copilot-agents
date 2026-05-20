#!/usr/bin/env node
import http from 'node:http';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { BrowserPool } from '../tools/lib/browser-pool.mjs';
import { resolveSearchConfig } from '../tools/lib/search-config.mjs';
import {
    extractGoogleAiModeResults,
    formatAiModeResponse,
} from '../tools/lib/headless-search-converter.mjs';

const MAX_BODY_BYTES = 32 * 1024;

const state = {
    config: resolveSearchConfig(process.env),
    pool: null,
    ready: false,
    initError: null,
};

let readyPromise = null;
let server = null;

export function startService() {
    readyPromise = initializeBrowserRuntime();
    server = http.createServer(async (req, res) => {
        try {
            if (req.method === 'GET' && req.url === '/status') {
                writeJson(res, 200, buildStatus());
                return;
            }

            if (req.method === 'POST' && req.url === '/search') {
                const body = await readJsonBody(req);
                const result = await handleSearch(body);
                writeJson(res, 200, result);
                return;
            }

            writeJson(res, 404, { ok: false, error: 'not found' });
        } catch {
            writeJson(res, 500, {
                ok: false,
                error: 'web search service failed',
            });
        }
    });

    server.listen(servicePort(state.config.serviceUrl), serviceHost(state.config.serviceUrl), () => {
        debug('web search service listening');
    });

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
    return server;
}

async function initializeBrowserRuntime() {
    if (!state.config.configured) {
        state.ready = true;
        state.initError = state.config.reason;
        return;
    }

    try {
        state.pool = new BrowserPool({
            poolSize: state.config.poolSize,
            executablePath: state.config.executablePath,
            headlessMode: state.config.headlessMode,
            proxyUrl: state.config.proxyUrl,
            userDataDir: state.config.userDataDir,
            log: serviceLog(),
        });
        await state.pool.warmUp();
    } catch (error) {
        state.pool = null;
        state.initError = classifySearchError(error).message;
    } finally {
        state.ready = true;
    }
}

async function handleSearch(body) {
    await readyPromise;

    const query = String(body?.query || body?.prompt || '').trim();
    if (!query) {
        return unavailable('A search query is required.', 'input');
    }

    if (!state.pool) {
        return unavailable(state.initError || 'local browser runtime is not available', 'configuration');
    }

    const timeoutMs = Number(body?.timeoutMs) || state.config.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
    let handle = null;
    try {
        handle = await state.pool.acquire(controller.signal);
        if (state.config.minRequestIntervalMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, state.config.minRequestIntervalMs));
        }

        const url = buildGoogleAiModeUrl(query);
        await handle.page.goto(url, {
            waitUntil: 'networkidle2',
            timeout: timeoutMs,
        });
        await dismissGoogleConsent(handle.page);
        await maybeCaptureDebugScreenshot(handle.page);

        const extracted = await extractGoogleAiModeResults(handle.page, {
            browser_timeout_ms: timeoutMs,
        });
        const finalAnswer = formatAiModeResponse(extracted.answer, extracted.citations, query);
        const hasResults = Boolean(extracted.answer || extracted.citations.length);

        return {
            ok: true,
            backend_ok: hasResults,
            final_answer: finalAnswer,
            natural_language_output: finalAnswer,
            sources: extracted.citations,
            ttl_hint_seconds: state.config.ttlSeconds,
            cacheable: hasResults,
            diagnostics: {
                execution: 'local-headless-browser',
                error_type: hasResults ? null : 'no_results',
            },
        };
    } catch (error) {
        const classified = classifySearchError(error);
        return unavailable(classified.message, classified.type, classified.retryable);
    } finally {
        clearTimeout(timer);
        if (handle) await state.pool.release(handle);
    }
}

export function buildGoogleAiModeUrl(query) {
    return `https://www.google.com/search?q=${encodeURIComponent(query)}&udm=50`;
}

export function classifySearchError(error) {
    const message = String(error?.message || '');
    if (error?.captchaDetected || message.includes('/sorry/')) {
        return {
            type: 'captcha',
            message: 'Web search is temporarily blocked by a CAPTCHA challenge.',
            retryable: true,
        };
    }
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError' || message.includes('Navigation timeout')) {
        return {
            type: 'timeout',
            message: 'Web search timed out while loading the search page.',
            retryable: true,
        };
    }
    if (message.includes('pool acquire timeout') || message.includes('pool is closed')) {
        return {
            type: 'browser_unavailable',
            message: 'The local browser pool is temporarily unavailable.',
            retryable: true,
        };
    }
    if (message.includes('puppeteer runtime not available')) {
        return {
            type: 'configuration',
            message: 'The local Puppeteer runtime is not available in webSearchAgent.',
            retryable: false,
        };
    }
    if (message.includes('ENOENT') || message.includes('executablePath')) {
        return {
            type: 'configuration',
            message: 'Chrome or Chromium is not available. Set BROWSER_EXECUTABLE_PATH or use the browser-enabled image.',
            retryable: false,
        };
    }
    if (message.includes('Target closed') || message.includes('disconnected')) {
        return {
            type: 'browser_unavailable',
            message: 'The local browser disconnected during search.',
            retryable: true,
        };
    }
    return {
        type: 'browser_error',
        message: 'Web search failed inside the local browser runtime.',
        retryable: true,
    };
}

async function dismissGoogleConsent(page) {
    const clicked = await page.evaluate(() => {
        const candidates = Array.from(
            document.querySelectorAll('button, input[type="submit"], div[role="button"]'),
        );
        const patterns = [
            /accept all/i,
            /i agree/i,
            /^accept$/i,
            /accept[ée]r alle/i,
            /accepter alle/i,
            /aceptar todo/i,
            /tout accepter/i,
            /alle akzeptieren/i,
        ];
        const target = candidates.find((el) => {
            const text = (el.innerText || el.value || el.textContent || '').trim();
            return patterns.some((pattern) => pattern.test(text));
        });
        if (!target) return false;
        target.click();
        return true;
    });

    if (!clicked) return;

    await Promise.race([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 4000)),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 1000));
}

async function maybeCaptureDebugScreenshot(page) {
    if (!state.config.debugScreenshots) return;
    try {
        const dir = join(process.env.DATA_DIR || '/data', 'screenshots');
        mkdirSync(dir, { recursive: true });
        await page.screenshot({
            path: join(dir, `headless-search-${Date.now()}.png`),
            fullPage: true,
        });
    } catch {
        // Debug screenshots are best-effort.
    }
}

function buildStatus() {
    return {
        ok: true,
        agent: 'webSearchAgent',
        mode: 'local-headless-browser',
        configured: state.config.configured && Boolean(state.pool),
        ready: state.ready,
        reason: state.ready
            ? (state.initError || state.config.reason || null)
            : 'local browser runtime is starting',
        browser: state.pool ? state.pool.status() : {
            total: state.config.poolSize,
            available: 0,
            busy: 0,
        },
        cache: {
            cacheable: true,
            ttlSeconds: state.config.ttlSeconds,
        },
    };
}

function unavailable(message, type, retryable = false) {
    const finalAnswer = `Web search is not available: ${message}`;
    return {
        ok: true,
        backend_ok: false,
        final_answer: finalAnswer,
        natural_language_output: finalAnswer,
        sources: [],
        ttl_hint_seconds: state.config.ttlSeconds,
        cacheable: false,
        diagnostics: {
            execution: 'local-headless-browser',
            error_type: type,
            retryable,
        },
    };
}

async function readJsonBody(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
            throw new Error('request body too large');
        }
        chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString('utf8').trim();
    return text ? JSON.parse(text) : {};
}

function writeJson(res, status, payload) {
    const text = JSON.stringify(payload);
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(text),
    });
    res.end(text);
}

function serviceHost(serviceUrl) {
    return new URL(serviceUrl).hostname;
}

function servicePort(serviceUrl) {
    const url = new URL(serviceUrl);
    return Number(url.port) || 80;
}

function serviceLog() {
    return {
        info(message, fields) {
            debug(message, fields);
        },
        warn(message, fields) {
            debug(message, fields);
        },
        error(message, fields) {
            debug(message, fields);
        },
        debug(message, fields) {
            debug(message, fields);
        },
    };
}

function debug(message, fields = {}) {
    if (String(process.env.ACHILLES_DEBUG || '').toLowerCase() !== 'true') return;
    process.stderr.write(`${JSON.stringify({ message, ...fields })}\n`);
}

async function shutdown() {
    if (server) server.close();
    if (state.pool) {
        await state.pool.closeAll().catch(() => {});
    }
    process.exit(0);
}

function isMainModule() {
    return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
    startService();
}
