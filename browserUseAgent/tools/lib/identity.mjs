export function getInvocationToken(envelope) {
    return envelope?.metadata && typeof envelope.metadata.invocationToken === 'string'
        ? envelope.metadata.invocationToken
        : '';
}

function identityFromInvocation(invocation) {
    if (!invocation || typeof invocation !== 'object') return '';
    if (invocation.usr && typeof invocation.usr === 'object') {
        return String(invocation.usr.id || invocation.usr.sub || '').trim();
    }
    return String(invocation.sub || '').trim();
}

function identityFromAuthInfo(authInfo) {
    if (!authInfo || typeof authInfo !== 'object') return '';
    if (authInfo.user && typeof authInfo.user === 'object') {
        return String(authInfo.user.id || authInfo.user.sub || '').trim();
    }
    return String(authInfo.userId || authInfo.sub || '').trim();
}

export function getUserId(envelope) {
    const metadata = envelope?.metadata || {};
    return identityFromInvocation(metadata.invocation)
        || identityFromAuthInfo(metadata.authInfo)
        || '';
}
