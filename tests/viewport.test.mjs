import test from 'node:test';
import assert from 'node:assert/strict';
import { availableModalHeight } from '../src/viewport.mjs';

test('keyboard overlay and native resize leave the same usable dialog height', () => {
  assert.equal(availableModalHeight(999, 999, 257), 742);
  assert.equal(availableModalHeight(742, 999, 257), 742);
});
test('keyboard hide, zoom and smaller desktop windows respect the visible viewport', () => {
  assert.equal(availableModalHeight(999, 999, 0), 999);
  assert.equal(availableModalHeight(700, 999, 0), 700);
  assert.equal(availableModalHeight(620, 620, 0), 620);
  assert.equal(availableModalHeight(620, 620, -10), 620);
});
