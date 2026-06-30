import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TESTS_DIR, '..', '..');
const AGENT_ROOT = path.join(REPO_ROOT, 'GPTResearcher');
const MANIFEST = path.join(AGENT_ROOT, 'manifest.json');
const MCP_CONFIG = path.join(AGENT_ROOT, 'mcp-config.json');
const SETTINGS_PLUGIN_CONFIG = path.join(AGENT_ROOT, 'IDE-plugins', 'gpt-researcher-settings', 'config.json');
const START_RESEARCH_ENTRY = path.join(AGENT_ROOT, 'scripts', 'start-research.py');
const GET_SETTINGS_ENTRY = path.join(AGENT_ROOT, 'scripts', 'get-settings.mjs');
const UPDATE_SETTINGS_ENTRY = path.join(AGENT_ROOT, 'scripts', 'update-settings.mjs');
const TEST_WORKSPACE_ROOT = path.join(os.tmpdir(), `gpt-researcher-agent-workspace-${process.pid}`);
const FIXED_SETTINGS_PATH = path.join(TEST_WORKSPACE_ROOT, 'gpt-researcher-settings.json');

function runStartResearch(input, env = {}) {
    return new Promise((resolve) => {
        const child = spawn('python3', [START_RESEARCH_ENTRY], {
            cwd: AGENT_ROOT,
            env: {
                ...process.env,
                WORKSPACE_PATH: TEST_WORKSPACE_ROOT,
                ...env,
            },
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });
        child.on('close', (code) => {
            resolve({ code: code ?? 0, stdout, stderr });
        });

        child.stdin.write(`${JSON.stringify({ input })}\n`);
        child.stdin.end();
    });
}

async function writeFakeGPTResearcherModule(tempDir) {
    const packageDir = path.join(tempDir, 'gpt_researcher');
    await fs.mkdir(packageDir, { recursive: true });
    await fs.writeFile(path.join(packageDir, '__init__.py'), `import os

class GPTResearcher:
    def __init__(self, query, report_type):
        self.query = query
        self.report_type = report_type

    async def conduct_research(self):
        print("conducting research")

    async def write_report(self):
        print("writing report")
        return "research report " + os.environ.get("FAST_LLM", "") + " " + os.environ.get("EMBEDDING", "")

    def get_research_context(self):
        return "research context"

    def get_costs(self):
        return {"total": 0.12}

    def get_research_images(self):
        return ["image-a"]

    def get_research_sources(self):
        return [{"title": "Source A"}]

    def get_source_urls(self):
        return ["https://example.com/source-a"]
`);
    return tempDir;
}

function runNodeScript(entry, input, env = {}) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [entry], {
            cwd: AGENT_ROOT,
            env: {
                ...process.env,
                WORKSPACE_PATH: TEST_WORKSPACE_ROOT,
                ...env,
            },
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });
        child.on('close', (code) => {
            resolve({ code: code ?? 0, stdout, stderr });
        });

        if (input !== undefined) {
            child.stdin.write(`${JSON.stringify({ input })}\n`);
        }
        child.stdin.end();
    });
}

async function withTemporaryFixedSettingsFile(fn) {
    const backupPath = path.join(os.tmpdir(), `gpt-researcher-settings-backup-${process.pid}-${Date.now()}.json`);
    let hadOriginal = false;
    try {
        await fs.mkdir(TEST_WORKSPACE_ROOT, { recursive: true });
        try {
            await fs.copyFile(FIXED_SETTINGS_PATH, backupPath);
            hadOriginal = true;
        } catch (error) {
            if (error?.code !== 'ENOENT') {
                throw error;
            }
        }
        await fs.rm(FIXED_SETTINGS_PATH, { force: true });
        return await fn();
    } finally {
        if (hadOriginal) {
            await fs.copyFile(backupPath, FIXED_SETTINGS_PATH);
            await fs.rm(backupPath, { force: true });
        } else {
            await fs.rm(FIXED_SETTINGS_PATH, { force: true });
        }
    }
}

test('GPTResearcher manifest uses Python-capable image and default AgentServer', async () => {
    const manifest = JSON.parse(await fs.readFile(MANIFEST, 'utf8'));

    assert.equal(manifest.container, 'docker.io/assistos/bwrap-runner:node24-python-bookworm');
    assert.equal(manifest.agent, undefined);
    assert.equal(manifest.readiness?.protocol, 'mcp');
    assert.equal(manifest.profiles?.default?.install, 'sh /code/scripts/install-gpt-researcher.sh');
    assert.equal(manifest.profiles?.default?.env, undefined);
    assert.deepEqual(manifest.env, [
        'OPENAI_API_KEY',
        'TAVILY_API_KEY',
        'ANTHROPIC_API_KEY',
        'GROQ_API_KEY',
        'OPENROUTER_API_KEY',
        'DEEPSEEK_API_KEY',
        'XAI_API_KEY',
        'MISTRAL_API_KEY',
        'GOOGLE_API_KEY',
    ]);
    assert.deepEqual(manifest.ideSettings, [
        {
            key: 'gpt-researcher-settings',
            label: 'GPTResearcher',
            scope: 'workspace',
            pluginKey: 'GPTResearcher/gpt-researcher-settings',
            settingsComponent: 'gpt-researcher-settings',
            adminOnly: false,
        },
    ]);
    assert.equal(manifest.volumes, undefined);
    assert.doesNotMatch(JSON.stringify(manifest), /PLOINKY_WORKSPACE_ROOT/);
    assert.doesNotMatch(JSON.stringify(manifest), /GPT_RESEARCHER_HOST|GPT_RESEARCHER_PORT/);
    assert.doesNotMatch(JSON.stringify(manifest), /GPT_RESEARCHER_SERVER_COMMAND|GPT_RESEARCHER_SERVER_ARGS/);
    assert.doesNotMatch(JSON.stringify(manifest), /SERPER_API_KEY|BING_API_KEY/);
});

test('GPTResearcher IDE plugin exposes settings through the Explorer settings model', async () => {
    const config = JSON.parse(await fs.readFile(SETTINGS_PLUGIN_CONFIG, 'utf8'));

    assert.equal(config.pluginCategory, 'application');
    assert.equal(config.id, 'gpt-researcher-settings');
    assert.equal(config.component, 'gpt-researcher-settings');
    assert.deepEqual(config.location, []);
    assert.equal(config.presenter, 'GPTResearcherSettings');
    assert.equal(config.type, 'global');
    assert.equal(config.settings, 'gpt-researcher-settings');
    assert.deepEqual(config.dependencies, []);
});

test('GPTResearcher start_research is registered as an async MCP tool', async () => {
    const config = JSON.parse(await fs.readFile(MCP_CONFIG, 'utf8'));
    const tool = config.tools.find((entry) => entry.name === 'start_research');

    assert.equal(tool?.async, true);
    assert.equal(tool?.command, '/opt/gpt-researcher-venv/bin/python');
    assert.deepEqual(tool?.args, ['/code/scripts/start-research.py']);
    assert.equal(tool?.timeoutMs, 600000);
    assert.deepEqual(tool?.tags, ['internal']);
    assert.equal(tool?.inputSchema?.query?.optional, false);
    assert.equal(tool?.inputSchema?.reportType?.optional, true);
});

test('GPTResearcher settings tools are registered as authenticated MCP tools', async () => {
    const config = JSON.parse(await fs.readFile(MCP_CONFIG, 'utf8'));
    const getTool = config.tools.find((entry) => entry.name === 'gpt_researcher_get_settings');
    const updateTool = config.tools.find((entry) => entry.name === 'gpt_researcher_update_settings');

    assert.equal(getTool?.command, '/usr/local/bin/node');
    assert.deepEqual(getTool?.args, ['/code/scripts/get-settings.mjs']);
    assert.deepEqual(getTool?.tags, ['authenticated']);
    assert.equal(updateTool?.command, '/usr/local/bin/node');
    assert.deepEqual(updateTool?.args, ['/code/scripts/update-settings.mjs']);
    assert.deepEqual(updateTool?.tags, ['authenticated']);
    assert.equal(updateTool?.inputSchema?.env?.additionalProperties, true);
});

test('install script uses pip for the Python package', async () => {
    const source = await fs.readFile(path.join(AGENT_ROOT, 'scripts', 'install-gpt-researcher.sh'), 'utf8');

    assert.match(source, /python3 -m venv "\$VENV_DIR"/);
    assert.match(source, /"\$VENV_DIR\/bin\/python" -m pip install --no-cache-dir gpt-researcher/);
    assert.match(source, /WORKSPACE_PATH is required/);
    assert.match(source, /SETTINGS_PATH="\$WORKSPACE_PATH\/gpt-researcher-settings\.json"/);
    assert.match(source, /gpt-researcher/);
    assert.doesNotMatch(source, /npm/);
});

test('start_research calls Python GPTResearcher and keeps stdout as JSON', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gpt-researcher-agent-test-'));
    try {
        const pythonPath = await writeFakeGPTResearcherModule(tempDir);
        const result = await runStartResearch({
            query: 'Does better context reduce hallucinations?',
            moreContext: 'Provide a detailed answer',
            reportType: 'research_report',
        }, {
            PYTHONPATH: pythonPath,
        });

        assert.equal(result.code, 0, result.stderr || result.stdout);
        const payload = JSON.parse(result.stdout);
        assert.equal(payload.ok, true);
        assert.equal(payload.report, 'research report ollama:llama3.1 ollama:nomic-embed-text');
        assert.equal(payload.reportType, 'research_report');
        assert.equal(payload.settings.fastLlm, 'ollama:llama3.1');
        assert.equal(payload.researchContext, 'research context');
        assert.deepEqual(payload.sourceUrls, ['https://example.com/source-a']);
        assert.match(payload.logTail, /conducting research/);
        assert.match(payload.logTail, /writing report/);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});

test('settings tools persist allowlisted provider settings', async () => {
    await withTemporaryFixedSettingsFile(async () => {
        const updateResult = await runNodeScript(UPDATE_SETTINGS_ENTRY, {
            fastLlm: 'groq:llama-3.3-70b-versatile',
            smartLlm: 'openrouter:anthropic/claude-sonnet-4',
            strategicLlm: 'ollama:qwen3',
            embedding: 'ollama:nomic-embed-text',
            retriever: 'duckduckgo',
            env: {
                OLLAMA_BASE_URL: 'http://ollama.local:11434',
                OPENAI_BASE_URL: 'http://openai-compatible.local/v1',
                NOT_ALLOWED_SECRET: 'nope',
            },
        });

        assert.equal(updateResult.code, 0, updateResult.stderr || updateResult.stdout);
        const updatePayload = JSON.parse(updateResult.stdout);
        assert.equal(updatePayload.ok, true);
        assert.equal(updatePayload.settings.fastLlm, 'groq:llama-3.3-70b-versatile');
        assert.equal(updatePayload.settings.env.OLLAMA_BASE_URL, 'http://ollama.local:11434');
        assert.equal(updatePayload.settings.env.NOT_ALLOWED_SECRET, undefined);

        const getResult = await runNodeScript(GET_SETTINGS_ENTRY);
        assert.equal(getResult.code, 0, getResult.stderr || getResult.stdout);
        const getPayload = JSON.parse(getResult.stdout);
        assert.equal(getPayload.ok, true);
        assert.equal(getPayload.settings.smartLlm, 'openrouter:anthropic/claude-sonnet-4');
        assert.equal(getPayload.settings.env.OPENAI_BASE_URL, 'http://openai-compatible.local/v1');
    });
});

test('start_research applies persisted settings before constructing GPTResearcher', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gpt-researcher-agent-test-'));
    try {
        const pythonPath = await writeFakeGPTResearcherModule(tempDir);
        await withTemporaryFixedSettingsFile(async () => {
            await fs.writeFile(FIXED_SETTINGS_PATH, JSON.stringify({
                fastLlm: 'groq:test-fast',
                smartLlm: 'openrouter:test-smart',
                strategicLlm: 'ollama:test-strategic',
                embedding: 'ollama:test-embed',
                retriever: 'duckduckgo',
                env: {
                    OLLAMA_BASE_URL: 'http://ollama.local:11434',
                },
            }));
            const result = await runStartResearch({
                query: 'Does better context reduce hallucinations?',
            }, {
                PYTHONPATH: pythonPath,
            });

            assert.equal(result.code, 0, result.stderr || result.stdout);
            const payload = JSON.parse(result.stdout);
            assert.equal(payload.ok, true);
            assert.equal(payload.settings.fastLlm, 'groq:test-fast');
            assert.equal(payload.settings.embedding, 'ollama:test-embed');
            assert.match(payload.report, /groq:test-fast ollama:test-embed/);
        });
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});

test('start_research rejects missing query', async () => {
    const result = await runStartResearch({});

    assert.notEqual(result.code, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /query is required/);
});
