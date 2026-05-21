#!/usr/bin/env node
import { readEnvelope, writeOk, writeError } from './lib/envelope.mjs';
import { resolveServiceConfig } from './lib/config.mjs';

async function fetchServiceStatus(config) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
        const response = await fetch(`${config.serviceUrl}/status`, {
            method: 'GET',
            headers: { accept: 'application/json' },
            signal: controller.signal,
        });
        if (!response.ok) {
            return {
                reachable: false,
                reason: `local browser service responded ${response.status}`,
            };
        }
        return {
            reachable: true,
            ...(await response.json()),
        };
    } catch {
        return {
            reachable: false,
            reason: 'local browser service is not reachable',
        };
    } finally {
        clearTimeout(timer);
    }
}

async function main() {
    try {
        await readEnvelope();
        const config = resolveServiceConfig(process.env);
        const service = await fetchServiceStatus(config);

        writeOk({
            agent: 'browserUseAgent',
            mode: 'provider',
            execution: 'local-browser-automation',
            browser: {
                configured: service.reachable,
                serviceUrl: config.serviceUrl,
                chromiumAvailable: service.chromiumAvailable ?? null,
                viewerTransport: service.viewerTransport || 'http-sse',
                activeSessions: service.activeSessions ?? 0,
                totalSessions: service.totalSessions ?? 0,
                reason: service.reason || null,
            },
            cache: {
                cacheable: false,
            },
        });
    } catch (error) {
        writeError(error && error.message ? error.message : 'browser_use_status failed');
    }
}

main();
