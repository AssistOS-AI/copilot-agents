import fs from 'node:fs';
import path from 'node:path';

import { findBackend, isBackendConfigured } from './backends.mjs';

const MAX_PROMPT_CHARS = 16000;
const MAX_RESOURCE_BYTES = 128 * 1024;
const MAX_TOTAL_RESOURCE_BYTES = 384 * 1024;
const STDERR_PREVIEW_CHARS = 4000;
const DEFAULT_TASK_TIMEOUT_MS = 110000;
const MIN_TASK_TIMEOUT_MS = 1000;
const MAX_TASK_TIMEOUT_MS = 120000;

function byteLength(text) {
    return Buffer.byteLength(String(text || ''), 'utf8');
}

function reject(message) {
    const error = new Error(message);
    error.code = 'COPILOT_PROVIDER_TASK_INVALID_INPUT';
    throw error;
}

function safeBasename(value, fallback) {
    const raw = String(value || '').trim();
    const base = path.basename(raw).replace(/[^A-Za-z0-9._-]/g, '_');
    return base || fallback;
}

function isTextMime(mime) {
    const value = String(mime || '').toLowerCase();
    return value.startsWith('text/')
        || value.includes('json')
        || value.includes('xml')
        || value.includes('yaml')
        || value.includes('markdown');
}

function resolveWorkspacePath(workspaceRoot, candidate) {
    if (!workspaceRoot) {
        reject('PLOINKY_WORKSPACE_ROOT is not set');
    }
    if (typeof candidate !== 'string' || !candidate.trim() || candidate.includes('\0')) {
        reject('resource path is invalid');
    }
    const root = path.resolve(workspaceRoot);
    let realRoot;
    try {
        realRoot = fs.realpathSync(root);
    } catch {
        reject('PLOINKY_WORKSPACE_ROOT is not available');
    }
    const resolved = path.isAbsolute(candidate)
        ? path.resolve(candidate)
        : path.resolve(root, candidate);
    const relative = path.relative(root, resolved);
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
        reject('resource path escapes workspace root');
    }
    let realResolved;
    try {
        realResolved = fs.realpathSync(resolved);
    } catch {
        reject(`resource path '${candidate}' is not available`);
    }
    const realRelative = path.relative(realRoot, realResolved);
    if (realRelative === '' || realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
        reject('resource path escapes workspace root');
    }
    return { path: realResolved, root: realRoot };
}

function normalizeInlineResource(raw, index) {
    if (!raw || typeof raw !== 'object') {
        reject('resource entries must be objects');
    }
    const name = safeBasename(raw.name || raw.filename || raw.path || raw.localPath, `resource-${index + 1}`);
    const mime = String(raw.mime || raw.contentType || 'application/octet-stream').trim() || 'application/octet-stream';
    if (typeof raw.content === 'string') {
        const size = byteLength(raw.content);
        if (size > MAX_RESOURCE_BYTES) {
            reject(`resource '${name}' exceeds ${MAX_RESOURCE_BYTES} bytes`);
        }
        return { name, mime, encoding: 'utf8', content: raw.content, size };
    }
    if (typeof raw.base64 === 'string') {
        const buffer = Buffer.from(raw.base64, 'base64');
        if (buffer.length > MAX_RESOURCE_BYTES) {
            reject(`resource '${name}' exceeds ${MAX_RESOURCE_BYTES} bytes`);
        }
        return { name, mime, encoding: 'base64', content: buffer.toString('base64'), size: buffer.length };
    }
    return null;
}

function normalizePathResource(raw, index, workspaceRoot) {
    const candidate = typeof raw === 'string'
        ? raw
        : (raw && typeof raw === 'object' ? raw.path : '');
    if (!candidate) {
        return null;
    }
    const resolved = resolveWorkspacePath(workspaceRoot, candidate);
    const stat = fs.statSync(resolved.path);
    if (!stat.isFile()) {
        reject(`resource path '${candidate}' is not a file`);
    }
    if (stat.size > MAX_RESOURCE_BYTES) {
        reject(`resource path '${candidate}' exceeds ${MAX_RESOURCE_BYTES} bytes`);
    }
    const buffer = fs.readFileSync(resolved.path);
    const mime = raw && typeof raw === 'object'
        ? String(raw.mime || raw.contentType || '').trim()
        : '';
    const finalMime = mime || (isTextMime(mime) ? mime : 'application/octet-stream');
    return {
        name: safeBasename(raw?.name || raw?.filename || resolved.path, `resource-${index + 1}`),
        mime: finalMime,
        encoding: 'base64',
        content: buffer.toString('base64'),
        size: buffer.length,
        source: path.relative(resolved.root, resolved.path),
    };
}

export function normalizeProviderTaskInput(input = {}, env = process.env) {
    const backend = findBackend(input.backend);
    if (!backend) {
        reject('backend is required and must match a known provider backend id');
    }

    const prompt = String(input.prompt || input.task || '').trim();
    if (!prompt) {
        reject('prompt is required');
    }
    if (prompt.length > MAX_PROMPT_CHARS) {
        reject(`prompt exceeds ${MAX_PROMPT_CHARS} characters`);
    }

    const workspaceRoot = String(env.PLOINKY_WORKSPACE_ROOT || '').trim();
    const resources = [];
    const rawResources = Array.isArray(input.resources) ? input.resources : [];
    rawResources.forEach((raw, index) => {
        const inline = normalizeInlineResource(raw, index);
        if (inline) resources.push(inline);
    });
    const rawPaths = Array.isArray(input.paths) ? input.paths : [];
    rawPaths.forEach((raw, index) => resources.push(normalizePathResource(raw, index, workspaceRoot)));

    let totalResourceBytes = 0;
    for (const resource of resources) {
        totalResourceBytes += Number(resource.size) || 0;
    }
    if (totalResourceBytes > MAX_TOTAL_RESOURCE_BYTES) {
        reject(`resources exceed ${MAX_TOTAL_RESOURCE_BYTES} bytes total`);
    }

    const timeoutMs = input.timeoutMs == null
        ? DEFAULT_TASK_TIMEOUT_MS
        : Number(input.timeoutMs);
    if (!Number.isFinite(timeoutMs) || timeoutMs < MIN_TASK_TIMEOUT_MS || timeoutMs > MAX_TASK_TIMEOUT_MS) {
        reject(`timeoutMs must be between ${MIN_TASK_TIMEOUT_MS} and ${MAX_TASK_TIMEOUT_MS}`);
    }

    return {
        backend,
        prompt,
        resources,
        timeoutMs: Math.floor(timeoutMs),
        origin: input.origin && typeof input.origin === 'object' ? input.origin : {},
        configured: isBackendConfigured(backend, env),
    };
}

export function isProviderBackend(task) {
    return Boolean(task && task.backend && task.backend.provider);
}

export function buildProviderInput(task) {
    return {
        prompt: task.prompt,
        timeoutMs: task.timeoutMs,
        resources: task.resources.map((resource) => ({
            name: resource.name,
            mime: resource.mime,
            encoding: resource.encoding === 'base64' ? 'base64' : 'utf8',
            content: resource.content,
            size: resource.size,
        })),
        origin: task.origin,
    };
}

function resourceMetadata(resource) {
    return {
        name: resource.name,
        mime: resource.mime,
        size: resource.size,
    };
}

export function normalizeProviderResult(providerPayload, task) {
    const resources = task?.resources ? task.resources.map(resourceMetadata) : [];
    if (!providerPayload || typeof providerPayload !== 'object') {
        return {
            ok: false,
            jobId: null,
            backend_ok: false,
            sandbox_ok: false,
            exitCode: null,
            final_answer: `Backend ${task?.backend?.label || 'provider'} returned no response.`,
            stderr_preview: '',
            resources,
            sources: [],
            cacheable: false,
            ttl_hint_seconds: null,
            timedOut: false,
            stdout_truncated: false,
            stderr_truncated: false,
        };
    }
    const finalAnswer = String(
        providerPayload.final_answer
            || providerPayload.natural_language_output
            || providerPayload.output
            || '',
    ).trim();
    return {
        ok: providerPayload.ok !== undefined ? Boolean(providerPayload.ok) : Boolean(finalAnswer),
        jobId: providerPayload.jobId || null,
        backend_ok: providerPayload.backend_ok !== undefined ? Boolean(providerPayload.backend_ok) : Boolean(providerPayload.ok),
        sandbox_ok: providerPayload.sandbox_ok !== undefined ? Boolean(providerPayload.sandbox_ok) : Boolean(providerPayload.ok),
        exitCode: providerPayload.exitCode ?? null,
        final_answer: finalAnswer
            || `Backend ${task?.backend?.label || 'provider'} did not return a natural-language response.`,
        stderr_preview: typeof providerPayload.stderr_preview === 'string'
            ? providerPayload.stderr_preview.slice(-STDERR_PREVIEW_CHARS)
            : '',
        resources: Array.isArray(providerPayload.resources) ? providerPayload.resources : resources,
        sources: Array.isArray(providerPayload.sources) ? providerPayload.sources : [],
        cacheable: providerPayload.cacheable !== undefined ? Boolean(providerPayload.cacheable) : false,
        ttl_hint_seconds: Number.isFinite(Number(providerPayload.ttl_hint_seconds))
            ? Number(providerPayload.ttl_hint_seconds)
            : null,
        timedOut: Boolean(providerPayload.timedOut),
        stdout_truncated: Boolean(providerPayload.stdout_truncated),
        stderr_truncated: Boolean(providerPayload.stderr_truncated),
    };
}
