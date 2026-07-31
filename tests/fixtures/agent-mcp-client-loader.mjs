const mockUrl = new URL('./agent-mcp-client.mock.mjs', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
    if (specifier === '/Agent/client/AgentMcpClient.mjs') {
        return { url: mockUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
}
