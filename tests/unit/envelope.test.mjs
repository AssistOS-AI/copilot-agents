import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeEnvelope } from '../../research-agents/tools/lib/envelope.mjs';
import { normalizeEnvelope as normalizeEnvelopeRelay } from '../../researchRelay/tools/lib/envelope.mjs';

test('normalizeEnvelope returns defaults for null', () => {
    const result = normalizeEnvelope(null);
    assert.deepEqual(result, { tool: '', input: {}, metadata: {} });
});

test('normalizeEnvelope keeps explicit input object', () => {
    const result = normalizeEnvelope({ tool: 't', input: { a: 1 } });
    assert.equal(result.tool, 't');
    assert.deepEqual(result.input, { a: 1 });
});

test('normalizeEnvelope unwraps single-key nested input', () => {
    const result = normalizeEnvelope({ tool: 't', input: { input: { profile: 'openhands' } } });
    assert.deepEqual(result.input, { profile: 'openhands' });
});

test('normalizeEnvelope parses string inputs as JSON', () => {
    const result = normalizeEnvelope({ tool: 't', input: '{"x":42}' });
    assert.deepEqual(result.input, { x: 42 });
});

test('normalizeEnvelope rejects non-object string inputs cleanly', () => {
    const result = normalizeEnvelope({ tool: 't', input: 'not-json' });
    assert.deepEqual(result.input, {});
});

test('researchRelay envelope matches bundle envelope semantics', () => {
    const a = normalizeEnvelope({ input: { backend: 'open-interpreter' } });
    const b = normalizeEnvelopeRelay({ input: { backend: 'open-interpreter' } });
    assert.deepEqual(a, b);
});
