#!/usr/bin/env node
import { readEnvelope, writeOk, writeError } from './lib/envelope.mjs';
import { resolveSearchConfig } from './lib/search-config.mjs';

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
        const config = resolveSearchConfig(process.env);
        const service = config.configured
            ? await fetchServiceStatus(config)
            : { reachable: false, reason: config.reason };

        writeOk({
            agent: 'webSearchAgent',
            mode: 'provider',
            execution: 'local-headless-browser',
            search: {
                configured: config.configured && service.reachable && service.configured !== false,
                serviceUrl: config.serviceUrl,
                poolSize: config.poolSize,
                browser: service.browser || null,
                timeoutMs: config.timeoutMs,
                reason: config.reason || service.reason || null,
            },
            cache: {
                cacheable: true,
                ttlSeconds: config.ttlSeconds,
            },
        });
    } catch (error) {
        writeError(error && error.message ? error.message : 'web_search_status failed');
    }
}

main();
