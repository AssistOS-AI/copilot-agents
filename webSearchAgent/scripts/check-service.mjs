#!/usr/bin/env node
import { resolveSearchConfig } from '../tools/lib/search-config.mjs';

const config = resolveSearchConfig(process.env);
try {
    const response = await fetch(`${config.serviceUrl}/status`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(1000),
    });
    process.exit(response.ok ? 0 : 1);
} catch {
    process.exit(1);
}
