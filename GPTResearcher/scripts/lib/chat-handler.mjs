import { runResearch } from './research-engine.mjs';

export async function readStdinJson() {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch {
        throw new Error('Invalid JSON payload');
    }
}

export async function handleChatCompletion(body, envelope = {}, env = process.env) {
    const prompt = extractPrompt(body?.messages);
    if (!prompt) {
        throw new Error('At least one user message is required');
    }
    if (body?.stream === true) {
        throw new Error('Streaming is not enabled for GPTResearcher');
    }

    const result = await runResearch({ prompt, request: body, envelope }, env);
    const created = Math.floor(Date.now() / 1000);
    return {
        id: `chatcmpl-gpt-researcher-${created}`,
        object: 'chat.completion',
        created,
        model: typeof body?.model === 'string' && body.model.trim() ? body.model.trim() : 'gpt-researcher',
        choices: [
            {
                index: 0,
                message: {
                    role: 'assistant',
                    content: result.responseText,
                },
                finish_reason: 'stop',
            },
        ],
        usage: {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
        },
        gpt_researcher: result.metadata,
    };
}

export function extractPrompt(messages) {
    if (!Array.isArray(messages)) return '';
    for (let i = messages.length - 1; i >= 0; i -= 1) {
        const message = messages[i];
        if (message?.role !== 'user') continue;
        const content = message.content;
        if (typeof content === 'string') return content.trim();
        if (Array.isArray(content)) {
            return content
                .filter((part) => part?.type === 'text' && typeof part.text === 'string')
                .map((part) => part.text)
                .join('\n')
                .trim();
        }
    }
    return '';
}
