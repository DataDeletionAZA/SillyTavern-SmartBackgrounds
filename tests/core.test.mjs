import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DEFAULT_SETTINGS,
    chooseAiScale,
    classifyImage,
    fitWithinLongEdge,
    makeOutputName,
} from '../src/core.js';

test('classifies small images for AI enhancement', () => {
    const plan = classifyImage({ width: 736, height: 414, bytes: 20_000 }, DEFAULT_SETTINGS);
    assert.equal(plan.mode, 'ai');
    assert.equal(plan.scale, 4);
});

test('uses 2x AI for images already near 2K', () => {
    assert.equal(chooseAiScale(2048, 4096), 2);
});

test('classifies oversized images for downscaling', () => {
    const plan = classifyImage({ width: 11623, height: 8717, bytes: 22_000_000 }, DEFAULT_SETTINGS);
    assert.equal(plan.mode, 'downscale');
    assert.equal(plan.targetLongEdge, 4096);
});

test('preserves aspect ratio when fitting the output', () => {
    assert.deepEqual(fitWithinLongEdge(8000, 6000, 4000), { width: 4000, height: 3000 });
});

test('creates stable WebP output names', () => {
    assert.equal(makeOutputName('pretty room.jpg', 'ai'), 'pretty room-smart-ai.webp');
    assert.equal(makeOutputName('pretty room-smart-ai.webp', 'downscale'), 'pretty room-smart-optimized.webp');
});
