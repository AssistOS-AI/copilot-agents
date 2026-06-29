import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    DEFAULT_SETTINGS,
    normalizeSettings,
    providerDiagnostics,
    resolveSettings,
    writeWorkspaceSettings,
} from '../../GPTResearcher/scripts/lib/settings.mjs';
import {
    extractPrompt,
    handleChatCompletion,
} from '../../GPTResearcher/scripts/lib/chat-handler.mjs';
import {
    collectWorkspaceContext,
    resolveOutputPath,
} from '../../GPTResearcher/scripts/lib/workspace-context.mjs';
import {
    registerSkillRoot,
    runResearch,
} from '../../GPTResearcher/scripts/lib/research-engine.mjs';
import {
    formatDuckDuckGoResult,
    parseInput as parseDuckDuckGoInput,
} from '../../GPTResearcher/skills/duckduckgo-search/src/index.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

describe('GPTResearcher manifest and plugin registration', () => {
    it('registers OpenAI-compatible runtime without research MCP tools', () => {
        const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'GPTResearcher', 'manifest.json'), 'utf8'));
        assert.equal(manifest.agent, undefined);
        assert.equal(manifest.readiness.protocol, 'mcp');
        const mcpConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, 'GPTResearcher', 'mcp-config.json'), 'utf8'));
        assert.deepEqual(manifest.endpoints.chatCompletions, {
            command: 'node',
            args: ['scripts/chat-completions.mjs'],
            supportsStream: false,
            model: 'gpt-researcher',
        });
        assert.deepEqual(mcpConfig.tools.map((tool) => tool.name), ['gpt_researcher_update_settings']);
        assert.equal(manifest.ideSettings[0].pluginKey, 'GPTResearcher/gpt-researcher-settings');
        assert.deepEqual(manifest.routerAccess.httpRoutes, [
            { path: '/IDE-plugins/gpt-researcher-settings/*', access: 'guest' },
            { path: '/v1/chat/completions', access: 'authenticated' },
        ]);
    });

    it('plugin config exposes a settings component', () => {
        const config = JSON.parse(fs.readFileSync(
            path.join(repoRoot, 'GPTResearcher', 'IDE-plugins', 'gpt-researcher-settings', 'config.json'),
            'utf8',
        ));
        assert.equal(config.settings, 'gpt-researcher-settings-modal');
        assert.equal(config.id, 'gpt-researcher-settings');
        assert.ok(config.location.includes('file-exp:settings'));
    });
});

describe('GPTResearcher settings', () => {
    it('defaults to DuckDuckGo', () => {
        assert.equal(DEFAULT_SETTINGS.provider, 'duckduckgo');
        assert.equal(normalizeSettings({}).provider, 'duckduckgo');
        assert.equal(normalizeSettings({ provider: 'unknown' }).provider, 'duckduckgo');
    });

    it('reports provider-specific missing environment values', () => {
        assert.deepEqual(providerDiagnostics({ provider: 'duckduckgo' }, {}).missing, []);
        assert.deepEqual(providerDiagnostics({ provider: 'tavily' }, {}).missing, ['TAVILY_API_KEY']);
        assert.deepEqual(providerDiagnostics({ provider: 'google' }, {}).missing, ['GOOGLE_API_KEY', 'GOOGLE_CSE_ID']);
        assert.deepEqual(providerDiagnostics({ provider: 'searxng', searxngUrl: '' }, {}).missing, ['searxngUrl']);
    });

    it('writes and reads provider settings from the workspace file', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gpt-researcher-settings-'));
        const written = writeWorkspaceSettings(root, { provider: 'serper', maxResults: 3, timeoutMs: 1000 });
        assert.equal(written.provider, 'serper');
        assert.equal(Object.hasOwn(written, 'timeoutMs'), false);
        const settings = resolveSettings({
            workspaceRoot: root,
            env: {},
        });
        assert.equal(settings.provider, 'serper');
        assert.equal(settings.maxResults, 3);
        assert.equal(Object.hasOwn(settings, 'timeoutMs'), false);
    });
});

describe('GPTResearcher request handling', () => {
    it('extracts the last user text prompt', () => {
        assert.equal(extractPrompt([
            { role: 'user', content: 'first' },
            { role: 'assistant', content: 'ok' },
            { role: 'user', content: [{ type: 'text', text: 'second' }] },
        ]), 'second');
    });

    it('rejects streaming requests', async () => {
        await assert.rejects(
            () => handleChatCompletion({ stream: true, messages: [{ role: 'user', content: 'x' }] }, {}),
            /Streaming is not enabled/,
        );
    });
});

describe('GPTResearcher workspace behavior', () => {
    it('filters large, dependency, and secret-like files', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gpt-researcher-context-'));
        fs.writeFileSync(path.join(root, 'README.md'), 'hello');
        fs.writeFileSync(path.join(root, 'secret.txt'), 'do not read');
        fs.mkdirSync(path.join(root, 'node_modules'));
        fs.writeFileSync(path.join(root, 'node_modules', 'package.json'), '{}');
        const files = collectWorkspaceContext(root);
        assert.deepEqual(files.map((file) => file.path), ['README.md']);
    });

    it('keeps output paths inside the workspace', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gpt-researcher-output-'));
        assert.equal(path.dirname(resolveOutputPath(root, '../report.md')), root);
    });

    it('writes a Markdown report and returns OpenAI-compatible metadata', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gpt-researcher-run-'));
        fs.writeFileSync(path.join(root, 'README.md'), '# Project\nUseful context.\n');
        const calls = [];
        const result = await runResearch({
            prompt: 'Create report.md without web using local only',
            request: {},
        }, {
            PLOINKY_PROJECT_DIR: root,
        }, {
            agentCodeRoot: path.join(repoRoot, 'GPTResearcher'),
            mainAgentFactory: async (config) => ({
                async executePrompt(message, options) {
                    calls.push({ config, message, options });
                    return {
                        status: 'completed',
                        result: '# Report\n\nUseful context.\n',
                    };
                },
            }),
        });
        assert.equal(result.metadata.outputPath, 'report.md');
        assert.equal(result.metadata.workspaceRoot, root);
        assert.ok(fs.existsSync(path.join(root, 'report.md')));
        assert.match(fs.readFileSync(path.join(root, 'report.md'), 'utf8'), /Useful context/);
        assert.match(result.responseText, /Generated report\.md/);
        assert.equal(calls.length, 1);
        assert.equal(calls[0].config.workspaceRoot, root);
        assert.match(calls[0].options.systemPrompt, /duckduckgo-search/);
        assert.equal(calls[0].options.context.workspaceRoot, root);
    });
});

describe('GPTResearcher local skill roots', () => {
    it('registers GPTResearcher skills from an explicit skill root', async () => {
        const registered = [];
        const agent = {
            _registerSkill(skillRecord) {
                registered.push(skillRecord);
            },
            _refreshOrchestratedSkillIndex() {},
        };
        const summary = await registerSkillRoot(
            agent,
            path.join(repoRoot, 'GPTResearcher', 'skills'),
            { debug() {}, info() {}, log() {}, warn() {}, error() {} },
        );
        assert.ok(summary.skills.includes('duckduckgo-search'));
        assert.ok(registered.some((skill) => skill.shortName === 'duckduckgo-search'));
        assert.ok(registered.every((skill) => skill.isInternal === false));
    });
});

describe('DuckDuckGo C-Skill', () => {
    it('parses text and JSON input', () => {
        assert.deepEqual(parseDuckDuckGoInput({ promptText: 'Albert Einstein' }), {
            query: 'Albert Einstein',
            maxResults: 5,
        });
        assert.deepEqual(parseDuckDuckGoInput({ promptText: '{"query":"Romania","maxResults":2}' }), {
            query: 'Romania',
            maxResults: 2,
        });
    });

    it('formats DuckDuckGo sources as text', () => {
        const text = formatDuckDuckGoResult({
            sources: [{
                title: 'Albert Einstein',
                url: 'https://en.wikipedia.org/wiki/Albert_Einstein',
                snippet: 'Physicist.',
            }],
        }, 'Albert Einstein');
        assert.match(text, /Provider: DuckDuckGo Instant Answer/);
        assert.match(text, /Results: 1/);
        assert.match(text, /https:\/\/en\.wikipedia\.org\/wiki\/Albert_Einstein/);
    });

    it('formats zero results without throwing', () => {
        const text = formatDuckDuckGoResult({ sources: [] }, 'OpenAI official website');
        assert.match(text, /Results: 0/);
        assert.match(text, /No DuckDuckGo Instant Answer sources/);
    });
});
