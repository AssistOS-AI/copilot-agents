import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
    collectWorkspaceContext,
    inferRequestedOutputName,
    resolveOutputPath,
    resolveWorkspaceRoot,
} from './workspace-context.mjs';

const require = createRequire(import.meta.url);
const AGENT_CODE_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const WORK_ROOT = path.resolve(AGENT_CODE_ROOT, '../../../..');

const NOOP_LOGGER = Object.freeze({
    debug() {},
    info() {},
    log() {},
    warn() {},
    error() {},
});

export async function runResearch({ prompt, request = {}, envelope = {} }, env = process.env, options = {}) {
    const workspaceRoot = resolveWorkspaceRoot(env);
    const localFiles = collectWorkspaceContext(workspaceRoot);
    const agentCodeRoot = options.agentCodeRoot || AGENT_CODE_ROOT;
    const mainAgentFactory = typeof options.mainAgentFactory === 'function'
        ? options.mainAgentFactory
        : createResearchMainAgent;
    const mainAgent = await mainAgentFactory({
        workspaceRoot,
        agentCodeRoot,
        env,
        request,
        envelope,
        logger: options.logger || NOOP_LOGGER,
    });
    const systemPrompt = buildResearchSystemPrompt({
        prompt,
        workspaceRoot,
        localFiles,
    });
    const agentPrompt = buildResearchPrompt({ prompt, localFiles });
    const execution = await mainAgent.executePrompt(agentPrompt, {
        model: request?.model || 'gpt-researcher',
        tags: ['research', 'writing'],
        systemPrompt,
        context: {
            workspaceRoot,
            agentCodeRoot,
            request,
            envelope,
            localFiles,
        },
    });
    const report = normalizeAgentReport(execution?.result, {
        prompt,
        workspaceRoot,
        localFiles,
    });
    const outputPath = resolveOutputPath(workspaceRoot, inferRequestedOutputName(prompt));
    fs.writeFileSync(outputPath, report, 'utf8');

    const relativeOutput = path.relative(workspaceRoot, outputPath);
    const responseText = [
        `Generated ${relativeOutput}.`,
        `Research status: ${execution?.status || 'completed'}.`,
        localFiles.length ? `Used ${localFiles.length} local file(s).` : 'No local text files were used.',
    ].join('\n');

    return {
        responseText,
        metadata: {
            outputPath: relativeOutput,
            workspaceRoot,
            agentCodeRoot,
            localFiles: localFiles.map((file) => file.path),
            status: execution?.status || null,
        },
    };
}

export async function createResearchMainAgent({ workspaceRoot, agentCodeRoot = AGENT_CODE_ROOT, logger = NOOP_LOGGER } = {}) {
    const { MainAgent } = await loadMainAgentModule();
    const agent = new MainAgent({
        startDir: workspaceRoot,
        logger,
        llmAgentOptions: {
            name: 'gpt-researcher-main-agent',
        },
    });
    await registerSkillRoot(agent, path.join(agentCodeRoot, 'skills'), logger);
    return agent;
}

export async function registerSkillRoot(agent, skillRoot, logger = NOOP_LOGGER) {
    if (!agent || !skillRoot || !fs.existsSync(skillRoot)) {
        return { skillRoot, discoveredCount: 0, skills: [] };
    }

    const { discoverSkillsFromRoot } = await loadMainAgentModule();
    const discovered = discoverSkillsFromRoot(skillRoot, { logger });
    for (const skillRecord of discovered) {
        skillRecord.isInternal = false;
        agent._registerSkill(skillRecord);
    }
    agent._refreshOrchestratedSkillIndex?.();
    return {
        skillRoot,
        discoveredCount: discovered.length,
        skills: discovered.map((skill) => skill.shortName || skill.name),
    };
}

async function loadMainAgentModule() {
    let modulePath = '';
    try {
        modulePath = require.resolve('achillesAgentLib/MainAgent');
    } catch {
        const candidates = [
            path.join(WORK_ROOT, 'ploinky', 'node_modules', 'achillesAgentLib', 'MainAgent', 'index.mjs'),
            '/code/node_modules/achillesAgentLib/MainAgent/index.mjs',
        ];
        modulePath = candidates.find((candidate) => fs.existsSync(candidate)) || '';
    }
    if (!modulePath) {
        throw new Error('achillesAgentLib/MainAgent is unavailable in this runtime.');
    }
    return import(pathToFileURL(modulePath).href);
}

export function buildResearchSystemPrompt({ workspaceRoot, localFiles }) {
    return [
        'You are GPTResearcher, a workspace research agent.',
        'Use the available tools when web research is useful. The duckduckgo-search tool is a zero-config DuckDuckGo Instant Answer source tool.',
        `The current workspace is: ${workspaceRoot}`,
        'Produce a complete Markdown document as your final answer.',
        'Include source URLs returned by tools when you use them.',
        'Do not claim you wrote files yourself. Return the document content; the runtime writes it into the workspace.',
        `Local files available: ${localFiles.map((file) => file.path).join(', ') || 'none'}.`,
    ].join('\n');
}

export function buildResearchPrompt({ prompt, localFiles }) {
    const lines = [];
    lines.push('Research task:');
    lines.push(prompt.trim());
    lines.push('');
    lines.push('Local context snippets:');
    if (!localFiles.length) {
        lines.push('No readable local text files were found.');
    } else {
        for (const file of localFiles) {
            lines.push(`\n### ${file.path}`);
            lines.push('```text');
            lines.push(file.snippet.trimEnd());
            lines.push('```');
        }
    }
    return lines.join('\n');
}

export function normalizeAgentReport(value, { prompt, workspaceRoot, localFiles }) {
    const text = typeof value === 'string'
        ? value.trim()
        : value == null
            ? ''
            : JSON.stringify(value, null, 2);
    if (text) {
        return text.endsWith('\n') ? text : `${text}\n`;
    }
    return renderFallbackMarkdownReport({ prompt, workspaceRoot, localFiles });
}

export function renderFallbackMarkdownReport({ prompt, workspaceRoot, localFiles }) {
    const lines = [];
    lines.push('# GPTResearcher Report');
    lines.push('');
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push(`Workspace: ${workspaceRoot}`);
    lines.push('');
    lines.push('## Request');
    lines.push('');
    lines.push(prompt.trim());
    lines.push('');
    lines.push('## Local Context');
    lines.push('');
    if (!localFiles.length) {
        lines.push('No readable local text files were found.');
    } else {
        for (const file of localFiles) {
            lines.push(`### ${file.path}`);
            lines.push('');
            lines.push('```text');
            lines.push(file.snippet.trimEnd());
            lines.push('```');
            lines.push('');
        }
    }
    lines.push('## Draft Result');
    lines.push('');
    lines.push('GPTResearcher did not return a final document. Use the local context above to continue the research task.');
    lines.push('');
    return `${lines.join('\n')}\n`;
}
