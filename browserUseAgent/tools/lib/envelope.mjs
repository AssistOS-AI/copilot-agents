import { Buffer } from 'node:buffer';

export async function readEnvelope() {
    return await new Promise((resolve, reject) => {
        const chunks = [];
        process.stdin.on('data', (chunk) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        process.stdin.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8').trim();
            if (!text) {
                resolve({ tool: '', input: {}, metadata: {} });
                return;
            }
            try {
                const parsed = JSON.parse(text);
                resolve(normalizeEnvelope(parsed));
            } catch (err) {
                reject(new Error(`Invalid JSON envelope on stdin: ${err.message}`));
            }
        });
        process.stdin.on('error', reject);
    });
}

export function normalizeEnvelope(value) {
    if (!value || typeof value !== 'object') {
        return { tool: '', input: {}, metadata: {} };
    }
    const tool = typeof value.tool === 'string' ? value.tool : '';
    const metadata = value.metadata && typeof value.metadata === 'object' ? value.metadata : {};

    let input = value.input;
    if (input && typeof input === 'object' && !Array.isArray(input)) {
        if (input.input && typeof input.input === 'object' && !Array.isArray(input.input)
            && Object.keys(input).length === 1) {
            input = input.input;
        }
    } else if (typeof input === 'string') {
        try {
            const parsed = JSON.parse(input);
            input = parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
            input = {};
        }
    } else {
        input = {};
    }
    return { tool, input, metadata };
}

export function writeOk(payload) {
    const body = { ok: true, ...payload };
    process.stdout.write(JSON.stringify(body));
}

export function writeError(message, extras) {
    const body = { ok: false, error: String(message || 'unknown error') };
    if (extras && typeof extras === 'object') {
        for (const [k, v] of Object.entries(extras)) {
            if (k !== 'ok' && k !== 'error') {
                body[k] = v;
            }
        }
    }
    process.stdout.write(JSON.stringify(body));
}
