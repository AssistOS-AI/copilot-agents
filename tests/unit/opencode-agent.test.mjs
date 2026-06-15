import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TESTS_DIR, '..', '..');
const EXECUTE_TASK_ENTRY = path.join(REPO_ROOT, 'opencodeAgent', 'scripts', 'execute-task.mjs');
const MCP_CONFIG = path.join(REPO_ROOT, 'opencodeAgent', 'mcp-config.json');

function runExecuteTask(input, env = {}) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [EXECUTE_TASK_ENTRY], {
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

async function writeFakeOpenCode(tempDir, source) {
    const scriptPath = path.join(tempDir, 'fake-opencode.mjs');
    await fs.writeFile(scriptPath, source);
    await fs.chmod(scriptPath, 0o755);
    return scriptPath;
}

test('opencode execute-task is registered as an async MCP tool', async () => {
    const config = JSON.parse(await fs.readFile(MCP_CONFIG, 'utf8'));
    const tool = config.tools.find((entry) => entry.name === 'execute-task');

    assert.equal(tool?.async, true);
});

test('execute-task streams opencode output to stderr and keeps MCP stdout as JSON', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-agent-test-'));
    try {
        const projectDir = path.join(tempDir, 'site');
        const argsFile = path.join(tempDir, 'args.json');
        const fakeOpenCode = await writeFakeOpenCode(tempDir, `#!/usr/bin/env node
import fs from 'node:fs';
fs.writeFileSync(process.env.FAKE_OPENCODE_ARGS_FILE, JSON.stringify(process.argv.slice(2)));
process.stdout.write('stdout line 1\\n');
process.stderr.write('stderr line 1\\n');
setTimeout(() => {
    process.stdout.write('stdout line 2\\n');
    process.stderr.write('stderr line 2\\n');
    process.exit(0);
}, 20);
`);

        const result = await runExecuteTask({
            prompt: 'Create a JavaScript file with an efficient sorting algorithm',
            projectDir,
            model: 'opencode/test-model',
        }, {
            OPENCODE_BIN: fakeOpenCode,
            FAKE_OPENCODE_ARGS_FILE: argsFile,
        });

        assert.equal(result.code, 0, result.stderr || result.stdout);
        const payload = JSON.parse(result.stdout);
        assert.equal(payload.ok, true);
        assert.equal(payload.projectDir, projectDir);
        assert.equal(payload.model, 'opencode/test-model');
        assert.match(payload.outputText, /stdout line 1/);
        assert.match(payload.outputText, /stdout line 2/);
        assert.doesNotMatch(payload.outputText, /stderr line 1/);
        assert.doesNotThrow(() => JSON.parse(result.stdout), 'MCP stdout must contain final JSON');

        const args = JSON.parse(await fs.readFile(argsFile, 'utf8'));
        assert.deepEqual(args, [
            'run',
            '--dangerously-skip-permissions',
            '--dir',
            projectDir,
            '--model',
            'opencode/test-model',
            'Create a JavaScript file with an efficient sorting algorithm',
        ]);

        const logs = result.stderr;
        assert.match(logs, /start projectDir=/);
        assert.match(logs, /\[opencode stdout\] stdout line 1/);
        assert.match(logs, /\[opencode stderr\] stderr line 1/);
        assert.match(logs, /\[opencode stdout\] stdout line 2/);
        assert.match(logs, /\[opencode stderr\] stderr line 2/);
        assert.match(logs, /exit code=0/);

        const stats = await fs.lstat(path.join(projectDir, '.opencode', 'skills'));
        assert.equal(stats.isSymbolicLink(), true);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});

test('execute-task remaps webAssist workspace projectDir to mounted data root', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-agent-test-'));
    try {
        const workspaceRoot = path.join(tempDir, 'workspace');
        const mountedDataRoot = path.join(tempDir, 'mounted-webassist-data');
        const hostProjectDir = path.join(workspaceRoot, '.ploinky', 'agents', 'webAssist', 'data', 'sites', 'localhost');
        const effectiveProjectDir = path.join(mountedDataRoot, 'sites', 'localhost');
        const argsFile = path.join(tempDir, 'args.json');
        const fakeOpenCode = await writeFakeOpenCode(tempDir, `#!/usr/bin/env node
import fs from 'node:fs';
fs.writeFileSync(process.env.FAKE_OPENCODE_ARGS_FILE, JSON.stringify(process.argv.slice(2)));
process.exit(0);
`);

        const result = await runExecuteTask({
            prompt: 'Create a JavaScript file with an efficient sorting algorithm',
            projectDir: hostProjectDir,
            model: 'opencode/test-model',
        }, {
            OPENCODE_BIN: fakeOpenCode,
            OPENCODE_WEBASSIST_DATA_ROOT: mountedDataRoot,
            PLOINKY_WORKSPACE_ROOT: workspaceRoot,
            FAKE_OPENCODE_ARGS_FILE: argsFile,
        });

        assert.equal(result.code, 0, result.stderr || result.stdout);
        const payload = JSON.parse(result.stdout);
        assert.equal(payload.ok, true);
        assert.equal(payload.projectDir, hostProjectDir);
        assert.equal(payload.effectiveProjectDir, effectiveProjectDir);

        const args = JSON.parse(await fs.readFile(argsFile, 'utf8'));
        assert.deepEqual(args, [
            'run',
            '--dangerously-skip-permissions',
            '--dir',
            effectiveProjectDir,
            '--model',
            'opencode/test-model',
            'Create a JavaScript file with an efficient sorting algorithm',
        ]);
        assert.match(result.stderr, /effectiveProjectDir=/);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});

test('execute-task returns bounded output tail on opencode failure', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-agent-test-'));
    try {
        const fakeOpenCode = await writeFakeOpenCode(tempDir, `#!/usr/bin/env node
process.stdout.write('before failure\\n');
process.stderr.write('failure details\\n');
process.exit(7);
`);

        const result = await runExecuteTask({
            prompt: 'Create a JavaScript file with an efficient sorting algorithm',
            projectDir: path.join(tempDir, 'site'),
            model: 'opencode/test-model',
        }, {
            OPENCODE_BIN: fakeOpenCode,
        });

        assert.notEqual(result.code, 0);
        const payload = JSON.parse(result.stdout);
        assert.equal(payload.ok, false);
        assert.match(payload.error, /exit code 7/);
        assert.match(payload.error, /failure details/);
        assert.match(payload.outputText, /failure details/);
        assert.equal(payload.model, 'opencode/test-model');

        const logs = result.stderr;
        assert.match(logs, /\[opencode stdout\] before failure/);
        assert.match(logs, /\[opencode stderr\] failure details/);
        assert.match(logs, /exit code=7/);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});

test('execute-task treats opencode permission auto-reject output as failure even with exit code 0', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-agent-test-'));
    try {
        const fakeOpenCode = await writeFakeOpenCode(tempDir, `#!/usr/bin/env node
process.stderr.write('! permission requested: external_directory (/tmp/site/*); auto-rejecting\\n');
process.stderr.write('✗ Read . failed\\n');
process.stderr.write('Error: The user rejected permission to use this specific tool call.\\n');
process.exit(0);
`);

        const result = await runExecuteTask({
            prompt: 'Create a JavaScript file with an efficient sorting algorithm',
            projectDir: path.join(tempDir, 'site'),
            model: 'opencode/test-model',
        }, {
            OPENCODE_BIN: fakeOpenCode,
        });

        assert.notEqual(result.code, 0);
        const payload = JSON.parse(result.stdout);
        assert.equal(payload.ok, false);
        assert.match(payload.error, /failed despite exit code 0/);
        assert.match(payload.error, /external_directory/);
        assert.equal(payload.model, 'opencode/test-model');

        assert.match(result.stderr, /permission requested: external_directory/);
        assert.match(result.stderr, /exit code=0/);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});

test('execute-task treats missing create-akus skill output as failure even with exit code 0', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-agent-test-'));
    try {
        const fakeOpenCode = await writeFakeOpenCode(tempDir, `#!/usr/bin/env node
process.stderr.write('✗ Skill "create-akus" failed\\n');
process.stderr.write('Error: Skill "create-akus" not found. Available skills: customize-opencode\\n');
process.exit(0);
`);

        const result = await runExecuteTask({
            prompt: 'Create a JavaScript file with an efficient sorting algorithm',
            projectDir: path.join(tempDir, 'site'),
            model: 'opencode/test-model',
        }, {
            OPENCODE_BIN: fakeOpenCode,
        });

        assert.notEqual(result.code, 0);
        const payload = JSON.parse(result.stdout);
        assert.equal(payload.ok, false);
        assert.match(payload.error, /failed despite exit code 0/);
        assert.match(payload.error, /create-akus/);

        assert.match(result.stderr, /Skill "create-akus" not found/);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});

test('execute-task allows successful opencode exit without an AKU manifest', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-agent-test-'));
    try {
        const projectDir = path.join(tempDir, 'site');
        const fakeOpenCode = await writeFakeOpenCode(tempDir, `#!/usr/bin/env node
process.stdout.write('Created a file somewhere else\\n');
process.exit(0);
`);

        const result = await runExecuteTask({
            prompt: 'Create a JavaScript file with an efficient sorting algorithm',
            projectDir,
            model: 'opencode/test-model',
        }, {
            OPENCODE_BIN: fakeOpenCode,
        });

        assert.equal(result.code, 0, result.stderr || result.stdout);
        const payload = JSON.parse(result.stdout);
        assert.equal(payload.ok, true);
        assert.match(payload.outputText, /Created a file somewhere else/);
        assert.equal(payload.projectDir, projectDir);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});

test('execute-task rejects the old wacData-only contract', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-agent-test-'));
    try {
        const result = await runExecuteTask({
            wacData: { siteInfo: 'legacy' },
            projectDir: path.join(tempDir, 'site'),
        }, {
            OPENCODE_BIN: '/bin/true',
        });

        assert.notEqual(result.code, 0);
        const payload = JSON.parse(result.stdout);
        assert.equal(payload.ok, false);
        assert.match(payload.error, /prompt is required/);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});
