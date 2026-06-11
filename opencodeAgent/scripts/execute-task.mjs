#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

const OPENCODE_BIN = '/root/.opencode/bin/opencode';
const OPENCODE_TIMEOUT_MS = 240000;

async function readStdin() {
    if (process.stdin.isTTY) {
        return '';
    }
    process.stdin.setEncoding('utf8');
    let data = '';
    for await (const chunk of process.stdin) {
        data += chunk;
    }
    return data;
}

function parseInput(raw) {
    const trimmed = String(raw ?? '').trim();
    if (!trimmed) {
        return null;
    }
    try {
        const parsed = JSON.parse(trimmed);
        return parsed.input && typeof parsed.input === 'object' ? parsed.input : parsed;
    } catch {
        return null;
    }
}

async function main() {
    const stdinData = await readStdin();
    const input = parseInput(stdinData);

    if (!input) {
        process.stdout.write(JSON.stringify({
            ok: false,
            error: 'Invalid or missing input. Expected JSON with prompt and projectDir.',
        }));
        process.exitCode = 1;
        return;
    }

    const { prompt, projectDir } = input;

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
        process.stdout.write(JSON.stringify({ ok: false, error: 'prompt is required and must be a non-empty string.' }));
        process.exitCode = 1;
        return;
    }

    if (!projectDir || typeof projectDir !== 'string' || !projectDir.trim()) {
        process.stdout.write(JSON.stringify({ ok: false, error: 'projectDir is required and must be a non-empty string.' }));
        process.exitCode = 1;
        return;
    }

    const resolvedProjectDir = path.resolve(projectDir.trim());

    try {
        await fs.mkdir(resolvedProjectDir, { recursive: true });
    } catch (error) {
        process.stdout.write(JSON.stringify({
            ok: false,
            error: `Failed to create project directory: ${error.message}`,
        }));
        process.exitCode = 1;
        return;
    }

    try {
        await execAsync(
            `${OPENCODE_BIN} run --agent build --prompt ${JSON.stringify(prompt.trim())} --dir ${JSON.stringify(resolvedProjectDir)}`,
            {
                timeout: OPENCODE_TIMEOUT_MS,
                env: {
                    ...process.env,
                    HOME: '/root',
                },
            },
        );

        process.stdout.write(JSON.stringify({
            ok: true,
            projectDir: resolvedProjectDir,
        }));
    } catch (error) {
        const isTimeout = error.killed || error.code === 'ETIMEDOUT' || error.message?.includes('timeout');
        process.stdout.write(JSON.stringify({
            ok: false,
            error: isTimeout
                ? `OpenCode task timed out after ${OPENCODE_TIMEOUT_MS / 1000}s`
                : `OpenCode task failed: ${error.message}`,
            projectDir: resolvedProjectDir,
        }));
        process.exitCode = 1;
    }
}

main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
});
