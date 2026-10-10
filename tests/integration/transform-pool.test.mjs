import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TransformPool } from '../../tools/transform-pool.mjs';
test('hard parser deadline terminates a stalled isolate and replaces it', async () => {
  const pool = new TransformPool({ size: 1, deadline: 300, workerURL: new URL('../fixtures/parser-stall.mjs', import.meta.url) });
  try {
    await assert.rejects(pool.run({ stall: true }), /timed out/);
    assert.equal(await pool.run({}), 'recovered');
    const controller = new AbortController(); const pending = pool.run({ stall: true }, controller.signal); controller.abort();
    await assert.rejects(pending, /cancelled/);
  } finally { pool.close(); }
});
