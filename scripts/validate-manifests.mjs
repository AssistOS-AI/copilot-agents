#!/usr/bin/env node
// Static validator for copilot-agents manifests, MCP configs, and IDE plugin
// configurations. Run from the repository root with `node scripts/validate-manifests.mjs`.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const AGENT_DIRS = [
    'research-agents',
    'copilotProviderRelay',
    'openInterpreterAgent',
    'webSearchAgent',
    'browserUseAgent',
];

const PLUGIN_ID_PATTERN = /^[A-Za-z][A-Za-z0-9-]*$/;
const PLOINKY_PROFILE_NAMES = new Set(['default', 'dev', 'qa', 'prod']);
const CONTAINER_SECURITY_FIELDS = new Set(['privileged']);
const GATED_PRIVILEGED_AGENT_DIRS = new Set(['openInterpreterAgent']);
const EXPECTED_CONTAINER_BY_AGENT = new Map([
    ['research-agents', 'node:20-alpine'],
    ['copilotProviderRelay', 'node:20-alpine'],
    ['openInterpreterAgent', 'docker.io/assistos/bwrap-runner:node24-python-bookworm'],
    ['webSearchAgent', 'node:24.15.0-bookworm-slim'],
    ['browserUseAgent', 'node:24.15.0-bookworm'],
]);

let failures = 0;

function fail(file, message) {
    failures += 1;
    process.stderr.write(`FAIL ${file}: ${message}\n`);
}

function ok(file, message) {
    process.stdout.write(`OK ${file}: ${message}\n`);
}

function gated(file, message) {
    process.stdout.write(`GATED ${file}: ${message}\n`);
}

function readJson(absPath) {
    try {
        return JSON.parse(fs.readFileSync(absPath, 'utf8'));
    } catch (err) {
        return { __error: err.message };
    }
}

function isPlainObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

export function containerSecurityValidationErrors(manifest, { allowPrivileged = false } = {}) {
    const errors = [];
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        return ['manifest root must be an object'];
    }
    if (Object.hasOwn(manifest, 'containerSecurity')) {
        const security = manifest.containerSecurity;
        if (!isPlainObject(security)) {
            errors.push('containerSecurity must be a plain object');
        } else {
            for (const key of Object.keys(security)) {
                if (!CONTAINER_SECURITY_FIELDS.has(key)) {
                    errors.push(`containerSecurity.${key} is unsupported`);
                }
            }
            if (Object.hasOwn(security, 'privileged')) {
                if (typeof security.privileged !== 'boolean') {
                    errors.push('containerSecurity.privileged must be boolean');
                } else if (security.privileged && !allowPrivileged) {
                    errors.push('privileged provider manifests are unsupported');
                }
            }
        }
    }
    if (manifest.profiles && typeof manifest.profiles === 'object' && !Array.isArray(manifest.profiles)) {
        for (const [name, profile] of Object.entries(manifest.profiles)) {
            if (profile !== null && typeof profile === 'object' && Object.hasOwn(profile, 'containerSecurity')) {
                errors.push(`profile ${name}.containerSecurity is unsupported; containerSecurity is root-only`);
            }
        }
    }
    return errors;
}

export function containerTopologyValidationErrors(agentDir, manifest) {
    const errors = [];
    const expectedContainer = EXPECTED_CONTAINER_BY_AGENT.get(agentDir);
    if (!expectedContainer) {
        return [`agent ${agentDir} is missing from the container topology`];
    }
    if (manifest?.container !== expectedContainer) {
        errors.push(`container must remain ${expectedContainer}`);
    }
    if (Object.hasOwn(manifest ?? {}, 'lite-sandbox')) {
        errors.push('lite-sandbox must be omitted so this image-backed agent remains container-routed');
    }
    return errors;
}

function gatedPrivilegeMatches(agentDir, manifest) {
    return GATED_PRIVILEGED_AGENT_DIRS.has(agentDir)
        && manifest?.container === 'docker.io/assistos/bwrap-runner:node24-python-bookworm'
        && manifest?.containerSecurity?.privileged === true;
}

function validateManifest(agentDir) {
    const manifestPath = path.join(REPO_ROOT, agentDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
        fail(manifestPath, 'manifest.json missing');
        return;
    }
    const manifest = readJson(manifestPath);
    if (manifest.__error) {
        fail(manifestPath, `invalid JSON: ${manifest.__error}`);
        return;
    }
    const gatedPrivilege = gatedPrivilegeMatches(agentDir, manifest);
    for (const error of containerTopologyValidationErrors(agentDir, manifest)) {
        fail(manifestPath, error);
    }
    for (const error of containerSecurityValidationErrors(manifest, { allowPrivileged: gatedPrivilege })) {
        fail(manifestPath, error);
    }
    if (gatedPrivilege) {
        gated(
            manifestPath,
            'privilege remains only until an immutable runner digest and native private-proc/Open Interpreter disposition proof are recorded',
        );
    }
    if (!manifest.container && !manifest.image) {
        fail(manifestPath, 'container or image field is required');
    }
    if (manifest.enable && !Array.isArray(manifest.enable)) {
        fail(manifestPath, 'enable must be an array');
    }
    if (manifest.profiles) {
        for (const [name, profile] of Object.entries(manifest.profiles)) {
            if (!PLOINKY_PROFILE_NAMES.has(name)) {
                fail(manifestPath, `profile ${name} is not selectable by current Ploinky; use default, dev, qa, or prod`);
            }
            if (profile && profile.enable && !Array.isArray(profile.enable)) {
                fail(manifestPath, `profile ${name}.enable must be an array`);
            }
        }
    }
    if (manifest.volumes) {
        if (Array.isArray(manifest.volumes) || typeof manifest.volumes !== 'object') {
            fail(manifestPath, 'volumes must be an object map of host path to container path');
        } else {
            for (const [hostPart, containerPart] of Object.entries(manifest.volumes)) {
                if (typeof hostPart !== 'string' || !hostPart.trim()) {
                    fail(manifestPath, `volume host path malformed: ${JSON.stringify(hostPart)}`);
                    continue;
                }
                if (typeof containerPart !== 'string' || !path.isAbsolute(containerPart)) {
                    fail(manifestPath, `volume container path must be absolute: ${JSON.stringify(containerPart)}`);
                    continue;
                }
                if (path.isAbsolute(hostPart) && !hostPart.includes('.ploinky')) {
                    fail(manifestPath, `host volume must resolve under .ploinky/: ${hostPart}`);
                }
                if (!path.isAbsolute(hostPart) && !hostPart.startsWith('.ploinky/')) {
                    fail(manifestPath, `host volume must start at .ploinky/: ${hostPart}`);
                }
            }
        }
    }
    if (Object.hasOwn(manifest, 'httpServices')) {
        fail(manifestPath, 'httpServices is unsupported; declare convention paths in routerAccess.httpRoutes');
    }
    ok(manifestPath, 'manifest.json valid');
}

function validateMcpConfig(agentDir) {
    const mcpPath = path.join(REPO_ROOT, agentDir, 'mcp-config.json');
    if (!fs.existsSync(mcpPath)) {
        return;
    }
    const config = readJson(mcpPath);
    if (config.__error) {
        fail(mcpPath, `invalid JSON: ${config.__error}`);
        return;
    }
    if (!Array.isArray(config.tools)) {
        fail(mcpPath, 'tools must be an array');
        return;
    }
    const seenNames = new Set();
    for (const tool of config.tools) {
        if (!tool || typeof tool !== 'object') {
            fail(mcpPath, 'tool entry must be an object');
            continue;
        }
        for (const field of ['name', 'description', 'command']) {
            if (typeof tool[field] !== 'string' || !tool[field].trim()) {
                fail(mcpPath, `tool ${tool.name || '?'} missing string field: ${field}`);
            }
        }
        if (typeof tool.name === 'string') {
            if (seenNames.has(tool.name)) {
                fail(mcpPath, `duplicate tool name: ${tool.name}`);
            }
            seenNames.add(tool.name);
        }
        if (tool.inputSchema && typeof tool.inputSchema !== 'object') {
            fail(mcpPath, `tool ${tool.name}: inputSchema must be an object`);
        }
    }
    ok(mcpPath, `mcp-config.json valid (${config.tools.length} tools)`);
}

function validatePluginConfigs(agentDir) {
    const pluginsDir = path.join(REPO_ROOT, agentDir, 'IDE-plugins');
    if (!fs.existsSync(pluginsDir)) {
        return;
    }
    for (const entry of fs.readdirSync(pluginsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
            continue;
        }
        const configPath = path.join(pluginsDir, entry.name, 'config.json');
        if (!fs.existsSync(configPath)) {
            fail(configPath, 'plugin config.json missing');
            continue;
        }
        const config = readJson(configPath);
        if (config.__error) {
            fail(configPath, `invalid JSON: ${config.__error}`);
            continue;
        }
        if (config.pluginCategory !== 'application') {
            fail(configPath, 'pluginCategory must be "application"');
        }
        if (typeof config.id !== 'string' || !PLUGIN_ID_PATTERN.test(config.id)) {
            fail(configPath, `plugin id must match ${PLUGIN_ID_PATTERN}; got "${config.id}"`);
        }
        const hasSettingsComponent = typeof config.settings === 'string' && config.settings.trim();
        if (!Array.isArray(config.location) || (config.location.length === 0 && !hasSettingsComponent)) {
            fail(configPath, 'location must be a non-empty array unless the plugin declares settings');
        } else {
            for (const slot of config.location) {
                if (typeof slot !== 'string' || !slot.startsWith('file-exp:')) {
                    fail(configPath, `unknown slot: ${slot}`);
                }
            }
        }
        if (config.contributionType === 'menu') {
            if (typeof config.menuModule !== 'string') {
                fail(configPath, 'menu contributions must declare menuModule');
            }
        } else if (typeof config.presenter !== 'string') {
            fail(configPath, 'mount contributions must declare presenter');
        }
        ok(configPath, `plugin config valid (${config.id})`);
    }
}

function validateAchillesSkills() {
    const skillsRoot = path.join(REPO_ROOT, 'achilles-skills');
    if (!fs.existsSync(skillsRoot)) {
        return;
    }
    for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
            continue;
        }
        const skillDir = path.join(skillsRoot, entry.name);
        const cskillPath = path.join(skillDir, 'cskill.md');
        const entryPath = path.join(skillDir, 'src', 'index.mjs');
        if (!fs.existsSync(cskillPath)) {
            fail(cskillPath, 'launcher skills must use deterministic cskill.md');
        }
        if (!fs.existsSync(entryPath)) {
            fail(entryPath, 'launcher cskills must provide src/index.mjs');
        }
        ok(skillDir, `Achilles launcher skill valid (${entry.name})`);
    }
}

export function runValidation() {
    failures = 0;
    for (const agentDir of AGENT_DIRS) {
        validateManifest(agentDir);
        validateMcpConfig(agentDir);
        validatePluginConfigs(agentDir);
    }
    validateAchillesSkills();

    if (failures > 0) {
        process.stderr.write(`\n${failures} validation failure(s)\n`);
        return false;
    }

    process.stdout.write('\nAll manifests, mcp-config files, plugin configs, and launcher skills validated.\n');
    return true;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
    if (!runValidation()) process.exit(1);
}
