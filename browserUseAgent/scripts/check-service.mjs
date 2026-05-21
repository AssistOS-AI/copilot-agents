#!/usr/bin/env node
const host = process.env.BROWSER_USE_SERVICE_HOST || '127.0.0.1';
const port = process.env.BROWSER_USE_SERVICE_PORT || process.env.PORT || '7000';
try {
    const res = await fetch(`http://${host}:${port}/status`, {
        signal: AbortSignal.timeout(1000),
    });
    process.exit(res.ok ? 0 : 1);
} catch {
    process.exit(1);
}
