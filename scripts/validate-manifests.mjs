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

function volumeMapValidationErrors(manifest) {
    const errors = [];
    if (!Object.hasOwn(manifest, 'volumes')) return errors;
    if (!isPlainObject(manifest.volumes)) {
        return ['volumes must be an object map of host path to container path'];
    }

    for (const [hostPart, containerPart] of Object.entries(manifest.volumes)) {
        if (typeof hostPart !== 'string' || !hostPart.trim()) {
            errors.push(`volume host path malformed: ${JSON.stringify(hostPart)}`);
            continue;
        }
        if (typeof containerPart !== 'string' || !path.posix.isAbsolute(containerPart)) {
            errors.push(`volume container path must be absolute: ${JSON.stringify(containerPart)}`);
        }
        if (path.posix.isAbsolute(hostPart)) {
            errors.push(`writable host volume must be workspace-relative beneath .data/: ${hostPart}`);
            continue;
        }
        const normalized = path.posix.normalize(hostPart);
        if (normalized !== hostPart) {
            errors.push(`writable host volume must already be normalized: ${hostPart}`);
            continue;
        }
        if (!normalized.startsWith('.data/')) {
            errors.push(`writable host volume must resolve beneath .data/: ${hostPart}`);
        }
    }
    return errors;
}

export function writableVolumeValidationErrors(manifest) {
    if (!isPlainObject(manifest)) return ['manifest root must be an object'];
    const errors = volumeMapValidationErrors(manifest);
    if (!Object.hasOwn(manifest, 'profiles')) return errors;
    if (!isPlainObject(manifest.profiles)) return [...errors, 'profiles must be an object map'];
    for (const [name, profile] of Object.entries(manifest.profiles)) {
        if (!isPlainObject(profile)) {
            errors.push(`profile ${name} must be an object`);
            continue;
        }
        errors.push(...volumeMapValidationErrors(profile).map(error => `profile ${name}: ${error}`));
    }
    return errors;
}

export function gatedPrivilegeMatches(agentDir, manifest) {
    return GATED_PRIVILEGED_AGENT_DIRS.has(agentDir)
        && manifest?.container === 'docker.io/assistos/bwrap-runner@sha256:9b6c08cf78fd0a29acfbe2e45ea2ee26efe6fde49c7f3db8b3aadfa30f2d53f8'
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
    for (const error of containerSecurityValidationErrors(manifest, { allowPrivileged: gatedPrivilege })) {
        fail(manifestPath, error);
    }
    if (gatedPrivilege) {
        gated(
            manifestPath,
            'existing compatibility privilege remains until native private-proc/provider certification; immutable transport-image proof alone does not certify rootless execution',
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
    for (const error of writableVolumeValidationErrors(manifest)) {
        fail(manifestPath, error);
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
