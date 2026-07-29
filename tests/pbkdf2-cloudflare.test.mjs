import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('PBKDF2 password hashes stay within the Cloudflare Workers limit', () => {
    const source = readFileSync(new URL('../functions/api/[[path]].js', import.meta.url), 'utf8');
    const iterations = Number(source.match(/async function passwordHash[\s\S]{0,300}?iterations\s*=\s*(\d+)/)?.[1]);

    assert.equal(Number.isInteger(iterations), true, 'PBKDF2 iteration count was not found');
    assert.ok(iterations <= 100_000, `Cloudflare Workers supports at most 100000 iterations, received ${iterations}`);
});
