import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const SAFE_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;

const REQUIRED_ADAPTER_EXPORTS = ['detectLoginRequired', 'submitPrompt'];

function validateProviderJson(raw, filePath) {
    if (!raw || typeof raw !== 'object') {
        throw new Error(`invalid provider.json at ${filePath}`);
    }
    if (typeof raw.id !== 'string' || !SAFE_ID_RE.test(raw.id)) {
        throw new Error(`provider id must match ${SAFE_ID_RE} at ${filePath}`);
    }
    if (typeof raw.label !== 'string' || !raw.label.trim()) {
        throw new Error(`provider label is required at ${filePath}`);
    }
    if (typeof raw.startUrl !== 'string' || !/^https?:\/\//.test(raw.startUrl)) {
        throw new Error(`provider startUrl must be an http(s) URL at ${filePath}`);
    }
    if (!Array.isArray(raw.aliases)) {
        throw new Error(`provider aliases must be an array at ${filePath}`);
    }
    for (const alias of raw.aliases) {
        if (typeof alias !== 'string' || !alias.trim()) {
            throw new Error(`provider aliases must be non-empty strings at ${filePath}`);
        }
    }
}

function validateAdapterExports(adapterModule, providerId, adapterPath) {
    for (const name of REQUIRED_ADAPTER_EXPORTS) {
        if (typeof adapterModule[name] !== 'function') {
            throw new Error(`adapter for '${providerId}' missing required export '${name}' at ${adapterPath}`);
        }
    }
}

function resolveProvidersDir() {
    const containerPath = '/code/providers';
    if (fs.existsSync(containerPath)) return containerPath;
    const thisDir = path.dirname(fileURLToPath(import.meta.url));
    return path.resolve(thisDir, '..', 'providers');
}

export async function loadProviderRegistry(options = {}) {
    const providersDir = options.providersDir || resolveProvidersDir();
    const providers = new Map();
    const aliasMap = new Map();
    let defaultProvider = null;

    let entries;
    try {
        entries = fs.readdirSync(providersDir, { withFileTypes: true });
    } catch {
        return buildRegistry(providers, aliasMap, defaultProvider);
    }

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const providerDir = path.join(providersDir, entry.name);
        const jsonPath = path.join(providerDir, 'provider.json');
        const adapterPath = path.join(providerDir, 'adapter.mjs');

        if (!fs.existsSync(jsonPath) || !fs.existsSync(adapterPath)) continue;

        let meta;
        try {
            meta = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        } catch (err) {
            throw new Error(`failed to parse ${jsonPath}: ${err.message}`);
        }

        validateProviderJson(meta, jsonPath);

        if (meta.enabled === false) continue;

        if (providers.has(meta.id)) {
            throw new Error(`duplicate provider id '${meta.id}'`);
        }

        for (const alias of meta.aliases) {
            const normalized = alias.trim().toLowerCase();
            if (aliasMap.has(normalized)) {
                throw new Error(`duplicate provider alias '${alias}' in '${meta.id}' (already claimed by '${aliasMap.get(normalized)}')`);
            }
        }

        let adapterModule;
        try {
            const importPath = options.importAdapter
                ? adapterPath
                : new URL(`file://${adapterPath}`).href;
            adapterModule = options.importAdapter
                ? await options.importAdapter(adapterPath)
                : await import(importPath);
        } catch (err) {
            throw new Error(`failed to load adapter for '${meta.id}': ${err.message}`);
        }

        validateAdapterExports(adapterModule, meta.id, adapterPath);

        const provider = {
            id: meta.id,
            label: meta.label,
            aliases: meta.aliases.map((a) => a.trim().toLowerCase()),
            startUrl: meta.startUrl,
            default: Boolean(meta.default),
            enabled: true,
            order: typeof meta.order === 'number' ? meta.order : 100,
            adapter: {
                detectLoginRequired: adapterModule.detectLoginRequired,
                submitPrompt: adapterModule.submitPrompt,
            },
        };

        providers.set(provider.id, provider);
        for (const alias of provider.aliases) {
            aliasMap.set(alias, provider.id);
        }

        if (provider.default && (!defaultProvider || provider.order < defaultProvider.order)) {
            defaultProvider = provider;
        }
    }

    return buildRegistry(providers, aliasMap, defaultProvider);
}

export function providerAdapterContext(provider) {
    if (!provider || typeof provider !== 'object') return null;
    return {
        id: provider.id,
        label: provider.label,
        aliases: Array.isArray(provider.aliases) ? [...provider.aliases] : [],
        startUrl: provider.startUrl,
        default: Boolean(provider.default),
        order: typeof provider.order === 'number' ? provider.order : 100,
    };
}

function buildRegistry(providers, aliasMap, defaultProvider) {
    return {
        getProvider(id) {
            return providers.get(id) || null;
        },

        getDefaultProvider() {
            return defaultProvider || null;
        },

        resolveProvider(value) {
            if (!value || typeof value !== 'string') {
                return defaultProvider || null;
            }
            const normalized = value.trim().toLowerCase();
            if (providers.has(normalized)) return providers.get(normalized);
            const mappedId = aliasMap.get(normalized);
            if (mappedId) return providers.get(mappedId) || null;
            return null;
        },

        listProviders() {
            return Array.from(providers.values())
                .sort((a, b) => a.order - b.order)
                .map((p) => ({
                    id: p.id,
                    label: p.label,
                    aliases: [...p.aliases],
                    default: p.default,
                    order: p.order,
                }));
        },

        get size() {
            return providers.size;
        },
    };
}
