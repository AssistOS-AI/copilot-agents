import fs from 'node:fs';
import path from 'node:path';

const SKIP_DIRS = new Set([
    '.git',
    '.ploinky',
    'node_modules',
    'vendor',
    'dist',
    'build',
    'coverage',
    '.cache',
    '.next',
    '.vite',
]);

const TEXT_EXTENSIONS = new Set([
    '.md',
    '.txt',
    '.json',
    '.js',
    '.mjs',
    '.cjs',
    '.ts',
    '.tsx',
    '.jsx',
    '.html',
    '.css',
    '.py',
    '.sh',
    '.yml',
    '.yaml',
    '.toml',
    '.xml',
    '.csv',
]);

const SECRET_NAME_PATTERN = /(^|[._-])(secret|token|password|passwd|credential|apikey|api-key|private-key)([._-]|$)/i;

export function resolveWorkspaceRoot(env = process.env) {
    const candidates = [
        env.PLOINKY_PROJECT_DIR,
        env.PLOINKY_WORKSPACE_ROOT,
        env.WORKSPACE_DIR,
        process.cwd(),
    ];
    for (const candidate of candidates) {
        if (!candidate) continue;
        try {
            const resolved = path.resolve(candidate);
            if (fs.statSync(resolved).isDirectory()) return resolved;
        } catch {
            continue;
        }
    }
    return process.cwd();
}

export function collectWorkspaceContext(root, options = {}) {
    const maxFiles = Number(options.maxFiles) || 24;
    const maxFileBytes = Number(options.maxFileBytes) || 48 * 1024;
    const maxSnippetChars = Number(options.maxSnippetChars) || 1800;
    const files = [];
    walk(root, root, files, { maxFiles, maxFileBytes, maxSnippetChars });
    return files;
}

export function resolveOutputPath(root, requestedName) {
    const fileName = sanitizeOutputName(requestedName || `gpt-researcher-${new Date().toISOString().replace(/[:.]/g, '-')}.md`);
    const candidate = path.resolve(root, fileName);
    const relative = path.relative(root, candidate);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('Output path must stay inside the workspace folder');
    }
    return candidate;
}

export function inferRequestedOutputName(prompt) {
    const text = String(prompt || '');
    const match = text.match(/(?:write|save|creeaza|crează|salveaza|salvează)[^\n]{0,80}?\b([\w.-]+\.(?:md|txt|json|html))\b/i)
        || text.match(/\b([\w.-]+\.(?:md|txt|json|html))\b/i);
    return match ? match[1] : '';
}

function walk(root, dir, files, options) {
    if (files.length >= options.maxFiles) return;
    let entries = [];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
        if (files.length >= options.maxFiles) return;
        const abs = path.join(dir, entry.name);
        const rel = path.relative(root, abs);
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue;
            if (entry.name.startsWith('.') && entry.name !== '.github') continue;
            walk(root, abs, files, options);
            continue;
        }
        if (!entry.isFile()) continue;
        if (rel === 'gpt-researcher-settings.json') continue;
        if (!isReadableTextFile(entry.name)) continue;
        if (SECRET_NAME_PATTERN.test(entry.name)) continue;
        try {
            const stat = fs.statSync(abs);
            if (stat.size > options.maxFileBytes) continue;
            const text = fs.readFileSync(abs, 'utf8');
            if (text.includes('\0')) continue;
            files.push({
                path: rel,
                size: stat.size,
                snippet: text.slice(0, options.maxSnippetChars),
            });
        } catch {
            continue;
        }
    }
}

function isReadableTextFile(name) {
    if (SECRET_NAME_PATTERN.test(name)) return false;
    return TEXT_EXTENSIONS.has(path.extname(name).toLowerCase()) || name === 'README' || name === 'LICENSE';
}

function sanitizeOutputName(name) {
    const normalized = String(name || '').trim().replace(/\\/g, '/').split('/').pop();
    if (!normalized || normalized === '.' || normalized === '..') return 'gpt-researcher-report.md';
    return normalized.replace(/[^A-Za-z0-9._-]/g, '-');
}
