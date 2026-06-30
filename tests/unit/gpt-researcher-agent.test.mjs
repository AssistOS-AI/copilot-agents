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
const START_RESEARCH_ENTRY = path.join(AGENT_ROOT, 'scripts', 'start-research.py');

function runStartResearch(input, env = {}) {
    return new Promise((resolve) => {
        const child = spawn('python3', [START_RESEARCH_ENTRY], {
            cwd: REPO_ROOT,
            env: {
                ...process.env,
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
    await fs.writeFile(path.join(packageDir, '__init__.py'), `class GPTResearcher:
    def __init__(self, query, report_type):
        self.query = query
        self.report_type = report_type

    async def conduct_research(self):
        print("conducting research")

    async def write_report(self):
        print("writing report")
        return "research report"

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

test('GPTResearcher manifest uses Python-capable image and default AgentServer', async () => {
    const manifest = JSON.parse(await fs.readFile(MANIFEST, 'utf8'));

    assert.equal(manifest.container, 'docker.io/assistos/bwrap-runner:node24-python-bookworm');
    assert.equal(manifest.agent, undefined);
    assert.equal(manifest.readiness?.protocol, 'mcp');
    assert.equal(manifest.profiles?.default?.install, 'sh /code/scripts/install-gpt-researcher.sh');
    assert.equal(manifest.profiles?.default?.env, undefined);
    assert.deepEqual(manifest.env, ['OPENAI_API_KEY', 'TAVILY_API_KEY']);
    assert.doesNotMatch(JSON.stringify(manifest), /PLOINKY_WORKSPACE_ROOT|ANTHROPIC_API_KEY/);
    assert.doesNotMatch(JSON.stringify(manifest), /GPT_RESEARCHER_HOST|GPT_RESEARCHER_PORT/);
    assert.doesNotMatch(JSON.stringify(manifest), /GPT_RESEARCHER_SERVER_COMMAND|GPT_RESEARCHER_SERVER_ARGS/);
    assert.doesNotMatch(JSON.stringify(manifest), /GOOGLE_API_KEY|SERPER_API_KEY|BING_API_KEY/);
});

test('GPTResearcher start_research is registered as an async MCP tool', async () => {
    const config = JSON.parse(await fs.readFile(MCP_CONFIG, 'utf8'));
    const tool = config.tools.find((entry) => entry.name === 'start_research');

    assert.equal(tool?.async, true);
    assert.equal(tool?.command, '/usr/bin/python3');
    assert.deepEqual(tool?.args, ['/code/scripts/start-research.py']);
    assert.equal(tool?.timeoutMs, 600000);
    assert.equal(tool?.inputSchema?.query?.optional, false);
    assert.equal(tool?.inputSchema?.reportType?.optional, true);
});

test('install script uses pip for the Python package', async () => {
    const source = await fs.readFile(path.join(AGENT_ROOT, 'scripts', 'install-gpt-researcher.sh'), 'utf8');

    assert.match(source, /python3 -m pip install --no-cache-dir gpt-researcher/);
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
        assert.equal(payload.report, 'research report');
        assert.equal(payload.reportType, 'research_report');
        assert.equal(payload.researchContext, 'research context');
        assert.deepEqual(payload.sourceUrls, ['https://example.com/source-a']);
        assert.match(payload.logTail, /conducting research/);
        assert.match(payload.logTail, /writing report/);
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
