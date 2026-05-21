const DEFAULT_TIMEOUT_MS = 120000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 300000;

export function resolveServiceConfig(env = process.env) {
    const host = String(env.BROWSER_USE_SERVICE_HOST || '127.0.0.1').trim();
    const port = String(env.BROWSER_USE_SERVICE_PORT || env.PORT || '7000').trim();
    const serviceUrl = `http://${host}:${port}`;
    const timeoutMs = clampTimeout(env.BROWSER_USE_TIMEOUT_MS);

    return {
        configured: true,
        serviceUrl,
        host,
        port,
        timeoutMs,
    };
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
