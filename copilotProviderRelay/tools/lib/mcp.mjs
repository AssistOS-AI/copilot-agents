// Ploinky AgentMcpClient verifies the runtime-owned signed Router descriptor
// before it can read the agent secret or construct a socket.
const AGENT_MCP_CLIENT_MODULE = '/Agent/client/AgentMcpClient.mjs';

export async function callAgentTool(agent, toolName, input = {}, options = {}) {
    const module = typeof options.createAgentClient === 'function'
        ? { createAgentClient: options.createAgentClient }
        : await import(AGENT_MCP_CLIENT_MODULE);
    if (typeof module.createAgentClient !== 'function') {
        throw new Error('Ploinky AgentMcpClient does not export createAgentClient');
    }
    const client = await module.createAgentClient(agent);
    const callOptions = {};
    Object.defineProperty(callOptions, 'userDelegationToken', {
        enumerable: true,
        get: () => options.invocationToken || '',
    });
    Object.defineProperty(callOptions, 'timeoutMs', {
        enumerable: true,
        get: () => options.timeoutMs,
    });
    try {
        return { result: await client.callTool(toolName, input || {}, callOptions) };
    } finally {
        await client.close?.();
    }
}

export function extractToolText(response) {
    const result = response && response.result ? response.result : response;
    if (typeof result === 'string') {
        return result;
    }
    if (result && Array.isArray(result.content)) {
        return result.content
            .filter((entry) => entry && entry.type === 'text' && typeof entry.text === 'string')
            .map((entry) => entry.text)
            .join('\n');
    }
    if (result && typeof result.text === 'string') {
        return result.text;
    }
    return '';
}

export function extractToolJson(response) {
    const result = response && response.result ? response.result : response;
    if (result && typeof result === 'object' && !Array.isArray(result)
        && !Array.isArray(result.content) && typeof result.text !== 'string') {
        return result;
    }
    const text = extractToolText(response).trim();
    if (!text) {
        return {};
    }
    try {
        return JSON.parse(text);
    } catch (error) {
        throw new Error(`invalid JSON tool response: ${error.message}`);
    }
}
