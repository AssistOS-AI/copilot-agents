#!/usr/bin/env node
// Report runtime readiness, configured model topology, canonical runner
// capability, and telemetry posture.

import { readEnvelope, writeOk, writeError } from './lib/envelope.mjs';
import { resolveOpenInterpreterRuntimeConfig } from './lib/achilles-llm-config.mjs';
import {
    BUNDLE_ID,
    BUNDLE_VERSION,
    bundleDir,
    readExistingManifest,
    resolveRuntimeRoot,
} from './lib/runtime-bundle.mjs';
import { inspectRunnerCapability } from './lib/runner-contract.mjs';

function bool(name, defaultValue) {
    const raw = process.env[name];
    if (raw == null || raw === '') return defaultValue;
    return ['1', 'true', 'yes', 'on', 'y'].includes(String(raw).toLowerCase());
}

async function main() {
    try {
        await readEnvelope();
        const runtimeRoot = resolveRuntimeRoot(process.env);
        const manifest = readExistingManifest(runtimeRoot);
        const resolvedConfig = await resolveOpenInterpreterRuntimeConfig({ env: process.env });
        const runnerAvailability = inspectRunnerCapability({ env: process.env });
        const providerUnavailable = resolvedConfig.source === 'box-unavailable';
        const availability = providerUnavailable
            ? {
                available: false,
                terminal: true,
                status: resolvedConfig.status,
                code: resolvedConfig.code,
                message: resolvedConfig.reason,
                cause: { code: 'OPEN_INTERPRETER_PROVIDER_CONTRACT_UNCERTIFIED' },
            }
            : {
                available: runnerAvailability.available,
                terminal: runnerAvailability.terminal,
                status: runnerAvailability.status,
                code: runnerAvailability.code,
                message: runnerAvailability.message,
                cause: runnerAvailability.cause,
            };
        writeOk({
            agent: 'openInterpreterAgent',
            mode: 'provider',
            availability,
            runtime: {
                root: runtimeRoot,
                bundleId: BUNDLE_ID,
                bundleVersion: BUNDLE_VERSION,
                bundleDir: bundleDir(runtimeRoot),
                prepared: Boolean(manifest),
                manifest,
            },
            sandbox: runnerAvailability,
            config: {
                source: resolvedConfig.source,
                model: resolvedConfig.config?.model || null,
                api_base: resolvedConfig.config?.api_base || null,
                context_window: resolvedConfig.config?.context_window || null,
                max_tokens: resolvedConfig.config?.max_tokens || null,
                offline: Boolean(resolvedConfig.config?.offline),
                local_endpoint: resolvedConfig.config?.local || null,
                brokered: resolvedConfig.source === 'achilles-soul-gateway',
                provider: resolvedConfig.achilles?.providerKey || null,
                provider_model: resolvedConfig.achilles?.providerModel || null,
                api_key_env: resolvedConfig.broker?.apiKeyEnv || null,
                missing_reason: ['missing', 'box-unavailable'].includes(resolvedConfig.source)
                    ? (resolvedConfig.reason || null)
                    : null,
            },
            telemetry: {
                disabled: bool('DISABLE_TELEMETRY', true),
                anonymized_disabled: !bool('ANONYMIZED_TELEMETRY', false),
            },
            paths: {
                workspaceRoot: process.env.PLOINKY_WORKSPACE_ROOT || null,
                dataRoot: '/data',
            },
        });
    } catch (error) {
        writeError(error && error.message ? error.message : 'oi_status failed');
    }
}

main();
