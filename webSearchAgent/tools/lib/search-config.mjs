const DEFAULT_SERVICE_HOST = '127.0.0.1';
const DEFAULT_SERVICE_PORT = 47731;
const DEFAULT_POOL_SIZE = 1;
const DEFAULT_TIMEOUT_MS = 60000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 90000;
const DEFAULT_TTL_SECONDS = 86400;
const DEFAULT_MIN_REQUEST_INTERVAL_MS = 2000;

export function resolveSearchConfig(env = process.env) {
    const poolSize = clampInteger(env.BROWSER_POOL_SIZE, DEFAULT_POOL_SIZE, 0, 8);
    const executablePath = trim(env.BROWSER_EXECUTABLE_PATH) || null;
    const headlessMode = trim(env.BROWSER_HEADLESS_MODE) || 'new';
    const proxyUrl = trim(env.BROWSER_PROXY_URL) || null;
    const userDataDir = trim(env.BROWSER_USER_DATA_DIR) || null;
    const timeoutMs = clampTimeout(env.WEB_SEARCH_TIMEOUT_MS);
    const minRequestIntervalMs = clampInteger(
        env.BROWSER_MIN_REQUEST_INTERVAL_MS,
        DEFAULT_MIN_REQUEST_INTERVAL_MS,
        0,
        60000,
    );
    const debugScreenshots = parseBoolean(env.WEB_SEARCH_DEBUG_SCREENSHOTS);
    const serviceUrl = resolveServiceUrl(env);

    if (poolSize < 1) {
        return {
            configured: false,
            mode: 'local-headless-browser',
            poolSize,
            executablePath,
            headlessMode,
            proxyUrl,
            userDataDir,
            timeoutMs,
            minRequestIntervalMs,
            debugScreenshots,
            serviceUrl,
            ttlSeconds: DEFAULT_TTL_SECONDS,
            reason: 'BROWSER_POOL_SIZE is 0; local browser search is disabled.',
        };
    }

    return {
        configured: true,
        mode: 'local-headless-browser',
        poolSize,
        executablePath,
        headlessMode,
        proxyUrl,
        userDataDir,
        timeoutMs,
        minRequestIntervalMs,
        debugScreenshots,
        serviceUrl,
        ttlSeconds: DEFAULT_TTL_SECONDS,
    };
}

export function resolveServiceUrl(env = process.env) {
    const explicit = trim(env.WEB_SEARCH_SERVICE_URL);
    if (explicit) return explicit.replace(/\/+$/, '');
    const host = trim(env.WEB_SEARCH_SERVICE_HOST) || DEFAULT_SERVICE_HOST;
    const port = clampInteger(env.WEB_SEARCH_SERVICE_PORT, DEFAULT_SERVICE_PORT, 1, 65535);
    return `http://${host}:${port}`;
}

export function clampTimeout(value) {
    if (value === undefined || value === null || value === '') {
        return DEFAULT_TIMEOUT_MS;
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return DEFAULT_TIMEOUT_MS;
    }
    return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, Math.floor(numeric)));
}

function trim(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function clampInteger(value, fallback, min, max) {
    if (value === undefined || value === null || value === '') {
        return fallback;
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return fallback;
    }
    return Math.max(min, Math.min(max, Math.floor(numeric)));
}

function parseBoolean(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

export {
    DEFAULT_POOL_SIZE,
    DEFAULT_SERVICE_HOST,
    DEFAULT_SERVICE_PORT,
    DEFAULT_TIMEOUT_MS,
    DEFAULT_TTL_SECONDS,
    DEFAULT_MIN_REQUEST_INTERVAL_MS,
};
