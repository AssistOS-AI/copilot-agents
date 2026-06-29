import fs from 'node:fs';
import path from 'node:path';

export const PROVIDERS = Object.freeze(['duckduckgo', 'tavily', 'serper', 'google', 'bing', 'searxng']);

export const DEFAULT_SETTINGS = Object.freeze({
    provider: 'duckduckgo',
    maxResults: 8,
    searxngUrl: '',
});
export const SETTINGS_FILE_NAME = 'gpt-researcher-settings.json';

export function resolveSettings({ workspaceRoot = '', env = process.env } = {}) {
    return normalizeSettings(readWorkspaceSettings(workspaceRoot), env);
}

export function readWorkspaceSettings(workspaceRoot) {
    if (!workspaceRoot) return {};
    const settingsPath = path.join(workspaceRoot, SETTINGS_FILE_NAME);
    try {
        return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch {
        return {};
    }
}

export function writeWorkspaceSettings(workspaceRoot, input = {}) {
    if (!workspaceRoot) throw new Error('Workspace root is required');
    const settings = normalizeSettings(input);
    const settingsPath = path.join(workspaceRoot, SETTINGS_FILE_NAME);
    const tempPath = `${settingsPath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
    fs.renameSync(tempPath, settingsPath);
    return settings;
}

export function normalizeSettings(input = {}, env = process.env) {
    const provider = normalizeProvider(input.provider);
    return {
        provider,
        maxResults: clampInteger(input.maxResults, DEFAULT_SETTINGS.maxResults, 1, 20),
        searxngUrl: normalizeUrl(input.searxngUrl),
    };
}

export function providerDiagnostics(settings, env = process.env) {
    const provider = normalizeProvider(settings?.provider);
    const missing = [];
    if (provider === 'tavily' && !trim(env.TAVILY_API_KEY)) missing.push('TAVILY_API_KEY');
    if (provider === 'serper' && !trim(env.SERPER_API_KEY)) missing.push('SERPER_API_KEY');
    if (provider === 'google') {
        if (!trim(env.GOOGLE_API_KEY)) missing.push('GOOGLE_API_KEY');
        if (!trim(env.GOOGLE_CSE_ID)) missing.push('GOOGLE_CSE_ID');
    }
    if (provider === 'bing' && !trim(env.BING_API_KEY)) missing.push('BING_API_KEY');
    if (provider === 'searxng' && !normalizeUrl(settings?.searxngUrl)) missing.push('searxngUrl');
    return {
        provider,
        configured: missing.length === 0,
        missing,
    };
}

function normalizeProvider(value) {
    const provider = trim(value).toLowerCase();
    return PROVIDERS.includes(provider) ? provider : DEFAULT_SETTINGS.provider;
}

function normalizeUrl(value) {
    const raw = trim(value).replace(/\/+$/, '');
    if (!raw) return '';
    try {
        const parsed = new URL(raw);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
        return parsed.toString().replace(/\/+$/, '');
    } catch {
        return '';
    }
}

function clampInteger(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(number)));
}

function trim(value) {
    return typeof value === 'string' ? value.trim() : '';
}
