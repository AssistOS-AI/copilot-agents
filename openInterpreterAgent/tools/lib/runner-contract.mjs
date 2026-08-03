import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

import {
    RUNNER_ABI,
    RUNNER_PROC_MINIMUM,
} from './runtime-bundle.mjs';

export const BWRAP_CAPABILITY_ERROR_CODE = 'PLOINKY_BWRAP_CAPABILITY_UNAVAILABLE';
export const OPEN_INTERPRETER_UNAVAILABLE_CODE = 'PLOINKY_OPEN_INTERPRETER_BOX_UNAVAILABLE';
export const RUNNER_READY_CODE = 'BWRAP_RUNNER_READY';
export const DEFAULT_RUNNER_HEALTHCHECK = '/opt/bwrap-runner/bin/healthcheck.mjs';

const MAX_HEALTHCHECK_OUTPUT_BYTES = 128 * 1024;

function parseLastJsonLine(value) {
    const lines = String(value || '').trim().split('\n').filter(Boolean);
    if (lines.length === 0) return null;
    try {
        const parsed = JSON.parse(lines.at(-1));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function unavailable(message, cause = null, capability = null) {
    return Object.freeze({
        ok: false,
        available: false,
        terminal: true,
        status: 422,
        code: OPEN_INTERPRETER_UNAVAILABLE_CODE,
        message,
        cause,
        runnerAbi: RUNNER_ABI,
        procMinimum: RUNNER_PROC_MINIMUM,
        capability,
    });
}

export function evaluateRunnerRecord(record) {
    if (!record || typeof record !== 'object') {
        return unavailable(
            'The canonical bwrap runner did not return a structured capability record.',
            { code: 'BWRAP_RUNNER_INVALID_CAPABILITY_RECORD' },
        );
    }
    if (record.runnerAbi !== RUNNER_ABI) {
        return unavailable(
            `Open Interpreter requires bwrap runner ABI ${RUNNER_ABI}.`,
            {
                code: 'BWRAP_RUNNER_ABI_INCOMPATIBLE',
                observedRunnerAbi: record.runnerAbi ?? null,
            },
            record.capability || null,
        );
    }
    if (record.ok !== true || record.code !== RUNNER_READY_CODE) {
        return unavailable(
            'Open Interpreter requires a certified private-proc bwrap capability.',
            {
                code: typeof record.code === 'string' ? record.code : BWRAP_CAPABILITY_ERROR_CODE,
            },
            record.capability || null,
        );
    }
    if (record.capability?.mode !== RUNNER_PROC_MINIMUM
        || record.capability?.minimum !== RUNNER_PROC_MINIMUM) {
        return unavailable(
            'Open Interpreter requires private proc; empty proc is not certified for this provider.',
            {
                code: BWRAP_CAPABILITY_ERROR_CODE,
                observedMode: record.capability?.mode || null,
                observedMinimum: record.capability?.minimum || null,
            },
            record.capability || null,
        );
    }
    return Object.freeze({
        ok: true,
        available: true,
        terminal: false,
        status: 200,
        code: RUNNER_READY_CODE,
        message: typeof record.message === 'string'
            ? record.message
            : 'The canonical bwrap runner satisfies the Open Interpreter private-proc minimum.',
        cause: null,
        runnerAbi: RUNNER_ABI,
        procMinimum: RUNNER_PROC_MINIMUM,
        capability: record.capability,
    });
}

export function inspectRunnerCapability({ env = process.env } = {}) {
    const healthcheckPath = String(env.OI_RUNNER_HEALTHCHECK_PATH || DEFAULT_RUNNER_HEALTHCHECK).trim();
    if (!healthcheckPath || !fs.existsSync(healthcheckPath)) {
        return unavailable(
            `The canonical bwrap runner healthcheck is not installed at ${healthcheckPath || DEFAULT_RUNNER_HEALTHCHECK}.`,
            { code: 'BWRAP_RUNNER_HEALTHCHECK_MISSING' },
        );
    }
    const result = spawnSync(process.execPath, [healthcheckPath, `--minimum=${RUNNER_PROC_MINIMUM}`], {
        encoding: 'utf8',
        timeout: 10000,
        maxBuffer: MAX_HEALTHCHECK_OUTPUT_BYTES,
        env: {
            PATH: env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
            HOME: env.HOME || '/data',
            LANG: env.LANG || 'C.UTF-8',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.error) {
        return unavailable(
            'The canonical bwrap runner capability check could not complete.',
            { code: 'BWRAP_RUNNER_HEALTHCHECK_FAILED' },
        );
    }
    const record = parseLastJsonLine(result.stdout);
    const evaluated = evaluateRunnerRecord(record);
    if (result.status !== 0 && evaluated.available) {
        return unavailable(
            'The canonical bwrap runner capability check exited unsuccessfully.',
            { code: BWRAP_CAPABILITY_ERROR_CODE },
            evaluated.capability,
        );
    }
    return evaluated;
}

export function evaluateRunnerTaskResult(result) {
    if (!result || typeof result !== 'object') return null;
    if (result.error?.code === BWRAP_CAPABILITY_ERROR_CODE
        || result.code === BWRAP_CAPABILITY_ERROR_CODE) {
        return unavailable(
            'Open Interpreter requires a certified private-proc bwrap capability.',
            { code: BWRAP_CAPABILITY_ERROR_CODE },
            result.capability || result.error?.capability || null,
        );
    }
    if (result.error && typeof result.error === 'object') {
        return unavailable(
            typeof result.error.message === 'string'
                ? result.error.message
                : 'The local bwrap runner could not execute the Open Interpreter task.',
            {
                code: typeof result.error.code === 'string'
                    ? result.error.code
                    : 'OI_LOCAL_RUNNER_FAILED',
            },
            result.capability || result.error.capability || null,
        );
    }
    if (result.runnerAbi !== RUNNER_ABI) {
        return unavailable(
            `Open Interpreter requires bwrap runner ABI ${RUNNER_ABI}.`,
            {
                code: 'BWRAP_RUNNER_ABI_INCOMPATIBLE',
                observedRunnerAbi: result.runnerAbi ?? null,
            },
            result.capability || null,
        );
    }
    if (result.procMode !== RUNNER_PROC_MINIMUM || result.procMinimum !== RUNNER_PROC_MINIMUM) {
        return unavailable(
            'Open Interpreter requires private proc; the runner result did not prove that minimum.',
            {
                code: BWRAP_CAPABILITY_ERROR_CODE,
                observedMode: result.procMode || null,
                observedMinimum: result.procMinimum || null,
            },
            result.capability || null,
        );
    }
    return null;
}
