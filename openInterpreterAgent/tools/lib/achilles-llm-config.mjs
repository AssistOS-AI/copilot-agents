import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const OPEN_INTERPRETER_CONFIG_SCHEMA = 'ploinky.open-interpreter.config.v1';
export const SOUL_GATEWAY_PROVIDER = 'soul_gateway';
export const SOUL_GATEWAY_API_KEY_ENV = 'SOUL_GATEWAY_API_KEY';
export const ACHILLES_RESEARCH_DEFAULT = 'research';

const require = createRequire(import.meta.url);
const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));

function stringValue(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function hasOwnEnvValue(env, name) {
    return Object.prototype.hasOwnProperty.call(env, name);
}

function loadDotEnvWalkUp(startDir, targetEnv = process.env) {
    let dir = path.resolve(startDir);
    const { root } = path.parse(dir);
    while (true) {
        const candidate = path.join(dir, '.env');
        if (fs.existsSync(candidate)) {
            try {
                const content = fs.readFileSync(candidate, 'utf8');
                for (const rawLine of content.split('\n')) {
                    let trimmed = rawLine.trim();
                    if (!trimmed || trimmed.startsWith('#')) continue;
                    if (trimmed.startsWith('export ')) trimmed = trimmed.slice(7).trim();
                    const eq = trimmed.indexOf('=');
                    if (eq === -1) continue;
                    const key = trimmed.slice(0, eq).trim();
                    let val = trimmed.slice(eq + 1).trim();
                    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                        val = val.slice(1, -1);
                    }
                    if (key && !targetEnv[key]) {
                        targetEnv[key] = val;
                    }
                }
            } catch (_) {
                // Keep dotenv loading best-effort, matching Achilles behavior.
            }
            return;
        }
        if (dir === root) return;
        dir = path.dirname(dir);
    }
}

function boolFromEnv(env, name, defaultValue = false) {
    const raw = env[name];
    if (raw == null || raw === '') return defaultValue;
    return ['1', 'true', 'yes', 'on', 'y'].includes(String(raw).trim().toLowerCase());
}

function createBaseRuntimeConfig(overrides = {}) {
    return {
        schema: OPEN_INTERPRETER_CONFIG_SCHEMA,
        model: null,
        api_base: null,
        api_key: null,
        local: null,
        offline: true,
        ...overrides,
    };
}

function parseModelReference(ref) {
    const trimmed = stringValue(ref);
    if (!trimmed) return { provider: null, model: '' };
    const slash = trimmed.indexOf('/');
    if (slash === -1) return { provider: null, model: trimmed };
    return {
        provider: trimmed.slice(0, slash).toLowerCase(),
        model: trimmed.slice(slash + 1),
    };
}

function mapGet(mapOrObject, key) {
    if (!mapOrObject) return null;
    if (mapOrObject instanceof Map) return mapOrObject.get(key) || null;
    if (typeof mapOrObject === 'object') return mapOrObject[key] || null;
    return null;
}

function normalizeBaseToChatCompletionsURL(baseURL) {
    const trimmed = stringValue(baseURL).replace(/\/+$/, '');
    if (!trimmed) return '';
    if (trimmed.endsWith('/chat/completions')) return trimmed;
    if (trimmed.endsWith('/v1')) return `${trimmed}/chat/completions`;
    return `${trimmed}/v1/chat/completions`;
}

function toOpenInterpreterOpenAIModel(modelName) {
    const model = stringValue(modelName);
    if (!model) return '';
    return model.startsWith('openai/') ? model : `openai/${model}`;
}

function explicitOpenInterpreterConfig(env) {
    const model = stringValue(env.OPEN_INTERPRETER_MODEL);
    const apiBase = stringValue(env.OPEN_INTERPRETER_API_BASE);
    const local = stringValue(env.OPEN_INTERPRETER_LOCAL);
    if (!model && !apiBase && !local) return null;
    return {
        source: 'explicit',
        config: createBaseRuntimeConfig({
            model: model || null,
            api_base: apiBase || null,
            local: local || null,
            offline: boolFromEnv(env, 'OPEN_INTERPRETER_OFFLINE', true),
        }),
        broker: null,
        sandbox: {
            allowNetwork: false,
        },
    };
}

function normalizeRawAchillesConfig(rawConfig = {}) {
    const providers = new Map();
    const rawProviders = rawConfig.providers && typeof rawConfig.providers === 'object'
        ? rawConfig.providers
        : {};
    for (const [providerKey, entry] of Object.entries(rawProviders)) {
        const record = entry && typeof entry === 'object' ? entry : {};
        providers.set(providerKey, {
            name: providerKey,
            providerKey,
            baseURL: stringValue(record.baseURL) || null,
            apiKeyEnv: stringValue(record.apiKeyEnv) || null,
            module: stringValue(record.module) || null,
        });
    }

    const defaults = new Map();
    const rawDefaults = rawConfig.defaults && typeof rawConfig.defaults === 'object'
        ? rawConfig.defaults
        : {};
    for (const [name, value] of Object.entries(rawDefaults)) {
        const modelRef = stringValue(value);
        if (modelRef) defaults.set(name, modelRef);
    }

    const models = new Map();
    const rawModels = Array.isArray(rawConfig.models) ? rawConfig.models : [];
    for (const entry of rawModels) {
        if (!entry || typeof entry !== 'object') continue;
        const name = stringValue(entry.name);
        const providerKey = stringValue(entry.provider || entry.providerKey);
        if (!name || !providerKey) continue;
        models.set(name, {
            name,
            providerKey,
            baseURL: stringValue(entry.baseURL) || null,
            apiKeyEnv: stringValue(entry.apiKeyEnv) || null,
        });
    }

    return {
        providers,
        defaults,
        models,
        issues: { errors: [], warnings: [] },
        path: null,
        raw: rawConfig,
    };
}

function candidateConfigPaths(env = process.env) {
    const candidates = [];
    const explicit = stringValue(env.LLM_MODELS_CONFIG_PATH);
    if (explicit) candidates.push(explicit);

    try {
        const packageJson = require.resolve('achillesAgentLib/package.json');
        candidates.push(path.join(path.dirname(packageJson), 'LLMConfig.json'));
    } catch (_) {
        // Bare package resolution is available in Ploinky containers through
        // /code/node_modules. Local unit tests may use the path fallbacks below.
    }

    candidates.push('/code/node_modules/achillesAgentLib/LLMConfig.json');

    const workspaceRoot = stringValue(env.PLOINKY_WORKSPACE_ROOT);
    if (workspaceRoot) {
        candidates.push(path.join(workspaceRoot, 'node_modules', 'achillesAgentLib', 'LLMConfig.json'));
        candidates.push(path.join(workspaceRoot, 'ploinky', 'node_modules', 'achillesAgentLib', 'LLMConfig.json'));
    }

    for (const start of [process.cwd(), CURRENT_DIR]) {
        let current = path.resolve(start);
        const root = path.parse(current).root;
        while (true) {
            candidates.push(path.join(current, 'node_modules', 'achillesAgentLib', 'LLMConfig.json'));
            candidates.push(path.join(current, 'ploinky', 'node_modules', 'achillesAgentLib', 'LLMConfig.json'));
            if (current === root) break;
            current = path.dirname(current);
        }
    }

    return [...new Set(candidates)];
}

async function loadViaAchillesExports(env = process.env) {
    const modulePath = 'achillesAgentLib/utils/LLMProviders/providers/modelsConfigLoader.mjs';
    const loader = await import(modulePath);
    const configPath = stringValue(env.LLM_MODELS_CONFIG_PATH) || undefined;
    const loaded = loader.loadRawConfig(configPath);
    const normalized = loader.normalizeConfig(loaded.raw || {});
    normalized.issues.errors.push(...(loaded.issues?.errors || []));
    normalized.issues.warnings.push(...(loaded.issues?.warnings || []));
    normalized.path = configPath || loaded.path || null;
    return normalized;
}

async function loadViaResolvedFile(env = process.env) {
    for (const candidate of candidateConfigPaths(env)) {
        if (!candidate || !fs.existsSync(candidate)) continue;
        const raw = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        const normalized = normalizeRawAchillesConfig(raw);
        normalized.path = candidate;
        return normalized;
    }
    throw new Error('achillesAgentLib LLMConfig.json could not be found');
}

export async function loadAchillesLLMConfiguration({ env = process.env } = {}) {
    try {
        return await loadViaAchillesExports(env);
    } catch (_) {
        return await loadViaResolvedFile(env);
    }
}

export async function resolveAchillesSoulGatewayConfig({ env = process.env } = {}) {
    const configuration = await loadAchillesLLMConfiguration({ env });
    const defaultRef = stringValue(mapGet(configuration.defaults, ACHILLES_RESEARCH_DEFAULT));
    if (!defaultRef) {
        throw new Error(`Achilles LLM config does not define a ${ACHILLES_RESEARCH_DEFAULT} default model`);
    }

    const parsed = parseModelReference(defaultRef);
    let providerKey = parsed.provider;
    let providerModel = parsed.model;
    if (!providerKey) {
        const modelDescriptor = mapGet(configuration.models, providerModel);
        providerKey = modelDescriptor?.providerKey || null;
        providerModel = modelDescriptor?.name || providerModel;
    }
    if (providerKey !== SOUL_GATEWAY_PROVIDER) {
        throw new Error(`Achilles ${ACHILLES_RESEARCH_DEFAULT} default resolves to ${providerKey || 'an unknown provider'}, not ${SOUL_GATEWAY_PROVIDER}`);
    }

    const provider = mapGet(configuration.providers, providerKey);
    if (!provider) {
        throw new Error(`Achilles provider ${SOUL_GATEWAY_PROVIDER} is not configured`);
    }

    const apiKeyEnv = stringValue(provider.apiKeyEnv) || SOUL_GATEWAY_API_KEY_ENV;
    if (apiKeyEnv !== SOUL_GATEWAY_API_KEY_ENV) {
        throw new Error(`Achilles provider ${SOUL_GATEWAY_PROVIDER} uses unsupported apiKeyEnv ${apiKeyEnv}`);
    }

    const upstreamUrl = normalizeBaseToChatCompletionsURL(provider.baseURL);
    if (!upstreamUrl) {
        throw new Error(`Achilles provider ${SOUL_GATEWAY_PROVIDER} does not define a baseURL`);
    }
    if (!providerModel) {
        throw new Error(`Achilles ${ACHILLES_RESEARCH_DEFAULT} default does not include a provider model`);
    }

    return {
        source: 'achilles',
        configPath: configuration.path || null,
        defaultName: ACHILLES_RESEARCH_DEFAULT,
        defaultRef,
        providerKey,
        providerModel,
        apiKeyEnv,
        upstreamUrl,
        openInterpreterModel: toOpenInterpreterOpenAIModel(providerModel),
    };
}

export async function resolveOpenInterpreterRuntimeConfig({ env = process.env } = {}) {
    const explicit = explicitOpenInterpreterConfig(env);
    if (explicit) return explicit;

    if (hasOwnEnvValue(env, SOUL_GATEWAY_API_KEY_ENV) && stringValue(env[SOUL_GATEWAY_API_KEY_ENV]) === '') {
        return {
            source: 'missing',
            config: createBaseRuntimeConfig({
                offline: boolFromEnv(env, 'OPEN_INTERPRETER_OFFLINE', true),
            }),
            broker: null,
            sandbox: { allowNetwork: false },
            reason: `${SOUL_GATEWAY_API_KEY_ENV} is not set`,
        };
    }

    loadDotEnvWalkUp(process.cwd(), env);

    let achilles = null;
    try {
        achilles = await resolveAchillesSoulGatewayConfig({ env });
    } catch (error) {
        return {
            source: 'missing',
            config: createBaseRuntimeConfig({
                offline: boolFromEnv(env, 'OPEN_INTERPRETER_OFFLINE', true),
            }),
            broker: null,
            sandbox: { allowNetwork: false },
            reason: error?.message || 'Achilles Soul Gateway configuration could not be resolved',
        };
    }

    const soulGatewayApiKey = stringValue(env[SOUL_GATEWAY_API_KEY_ENV]);
    if (!soulGatewayApiKey) {
        return {
            source: 'missing',
            config: createBaseRuntimeConfig({
                offline: boolFromEnv(env, 'OPEN_INTERPRETER_OFFLINE', true),
            }),
            broker: null,
            sandbox: { allowNetwork: false },
            reason: `${SOUL_GATEWAY_API_KEY_ENV} is not set`,
        };
    }

    return {
        source: 'achilles-soul-gateway',
        config: createBaseRuntimeConfig({
            model: achilles.openInterpreterModel,
            offline: false,
        }),
        achilles,
        broker: {
            upstreamUrl: achilles.upstreamUrl,
            upstreamModel: achilles.providerModel,
            upstreamApiKey: soulGatewayApiKey,
            apiKeyEnv: achilles.apiKeyEnv,
        },
        sandbox: {
            allowNetwork: true,
        },
    };
}

export function buildBrokeredRuntimeConfig(resolution, { apiBase, sandboxApiKey } = {}) {
    return {
        ...createBaseRuntimeConfig(resolution?.config || {}),
        api_base: stringValue(apiBase) || null,
        api_key: stringValue(sandboxApiKey) || null,
        offline: false,
        local: null,
    };
}

export function __privateForTests() {
    return {
        normalizeBaseToChatCompletionsURL,
        normalizeRawAchillesConfig,
        parseModelReference,
        toOpenInterpreterOpenAIModel,
    };
}
