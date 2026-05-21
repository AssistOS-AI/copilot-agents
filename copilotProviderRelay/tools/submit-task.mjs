#!/usr/bin/env node
import { readEnvelope, writeOk, writeError } from './lib/envelope.mjs';
import { callAgentTool, extractToolJson } from './lib/mcp.mjs';
import {
    buildProviderInput,
    isProviderBackend,
    normalizeProviderResult,
    normalizeProviderTaskInput,
} from './lib/task.mjs';

const PROVIDER_PREPARE_TIMEOUT_MS = 330000;

function getInvocationToken(envelope) {
    return envelope.metadata && typeof envelope.metadata.invocationToken === 'string'
        ? envelope.metadata.invocationToken
        : '';
}

async function runProviderBackend(task, invocationToken) {
    const providerInput = buildProviderInput(task);
    const response = await callAgentTool(
        task.backend.provider.agent,
        task.backend.provider.tool,
        providerInput,
        { timeoutMs: task.timeoutMs + PROVIDER_PREPARE_TIMEOUT_MS, invocationToken },
    );
    const providerPayload = extractToolJson(response);
    const normalized = normalizeProviderResult(providerPayload, task);
    writeOk({
        backend: task.backend.id,
        label: task.backend.label,
        provider_agent: task.backend.provider.agent,
        provider_tool: task.backend.provider.tool,
        bwrap_agent: null,
        jobId: normalized.jobId,
        sandbox_ok: normalized.sandbox_ok,
        backend_ok: normalized.backend_ok,
        natural_language_output: normalized.final_answer,
        final_answer: normalized.final_answer,
        resources: normalized.resources,
        sources: normalized.sources,
        cacheable: normalized.cacheable,
        ttl_hint_seconds: normalized.ttl_hint_seconds,
        state: normalized.state,
        sessionId: normalized.sessionId,
        viewerUrl: normalized.viewerUrl,
        requires_user_action: normalized.requires_user_action,
        interactive: normalized.interactive,
        origin: task.origin,
        diagnostics: {
            exitCode: normalized.exitCode,
            timedOut: normalized.timedOut,
            stdout_truncated: normalized.stdout_truncated,
            stderr_truncated: normalized.stderr_truncated,
            stderr_preview: normalized.stderr_preview,
        },
    });
}

async function main() {
    try {
        const envelope = await readEnvelope();
        const invocationToken = getInvocationToken(envelope);
        if (!invocationToken) {
            writeError('copilot_provider_task_submit requires a router invocation token');
            return;
        }

        const task = normalizeProviderTaskInput(envelope.input || {});
        if (isProviderBackend(task)) {
            await runProviderBackend(task, invocationToken);
            return;
        }
        writeError(`backend '${task.backend.id}' does not have a provider agent`);
    } catch (error) {
        writeError(error && error.message ? error.message : 'copilot_provider_task_submit failed');
    }
}

main();
