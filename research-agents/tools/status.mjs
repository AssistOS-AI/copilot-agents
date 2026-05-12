#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEnvelope, writeOk, writeError } from './lib/envelope.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadManifest() {
    const manifestPath = path.resolve(__dirname, '..', 'manifest.json');
    const raw = fs.readFileSync(manifestPath, 'utf8');
    return JSON.parse(raw);
}

function parseEnableEntries(entries) {
    if (!Array.isArray(entries)) {
        return [];
    }
    return entries
        .map((entry) => {
            const tokens = String(entry).trim().split(/\s+/).filter(Boolean);
            const stripped = tokens.filter((t) => t.toLowerCase() !== 'no-wait');
            return {
                raw: entry,
                agent: stripped[0] || '',
                mode: stripped[1] || '',
                noWait: tokens.some((t) => t.toLowerCase() === 'no-wait'),
            };
        })
        .filter((entry) => entry.agent);
}

async function main() {
    try {
        const envelope = await readEnvelope();
        const input = envelope.input || {};
        const manifest = loadManifest();

        const defaultEnable = parseEnableEntries(manifest.enable);
        const profiles = {};
        if (manifest.profiles && typeof manifest.profiles === 'object') {
            for (const [name, profile] of Object.entries(manifest.profiles)) {
                profiles[name] = parseEnableEntries(profile && profile.enable);
            }
        }

        const requestedProfile = typeof input.profile === 'string' ? input.profile.trim() : '';
        const profileName = requestedProfile && profiles[requestedProfile] ? requestedProfile : 'default';
        const active = profileName === 'default' && !profiles.default
            ? defaultEnable
            : (profiles[profileName] || defaultEnable);

        writeOk({
            bundle: 'research-agents',
            profile: profileName,
            agents: active.map(({ agent, mode, noWait }) => ({ agent, mode, noWait })),
            availableProfiles: Object.keys(profiles),
        });
    } catch (error) {
        writeError(error && error.message ? error.message : 'research_agents_status failed');
    }
}

main();
