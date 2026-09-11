import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveStatus } from './utils.js';

test('item state is derived from its remaining quantities', () => {
  assert.equal(deriveStatus(3, 0, 0), 'available');
  assert.equal(deriveStatus(3, 3, 0), 'reserved');
  assert.equal(deriveStatus(3, 0, 3), 'in_transit');
  assert.equal(deriveStatus(0, 0, 0), 'sold');
});

test('available stock takes precedence when only part of a quantity is allocated', () => {
  assert.equal(deriveStatus(5, 2, 0), 'available');
  assert.equal(deriveStatus(5, 0, 2), 'available');
});
