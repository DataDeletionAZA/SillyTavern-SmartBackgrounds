import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DEFAULT_SETTINGS,
    buildTilePlan,
    chooseAiScale,
    classifyImage,
    fitWithinLongEdge,
    isMobilePlatform,
    makeOutputName,
    makeUniqueWebpFilename,
    normalizeWebpFilename,
    shouldCommitReplacement,
} from '../src/core.js';

test('classifies small images for AI enhancement', () => {
    const plan = classifyImage({ width: 736, height: 414, bytes: 20_000 }, DEFAULT_SETTINGS);
    assert.equal(plan.mode, 'ai');
    assert.equal(plan.scale, 4);
});

test('uses conservative restoration strength by default', () => {
    assert.equal(DEFAULT_SETTINGS.aiStrength, 0.4);
});

test('plans a 2x final output for images already near 2K', () => {
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

test('creates overlapping tiles that cover the full image exactly once', () => {
    const tiles = buildTilePlan(300, 180, 128, 16);
    assert.equal(tiles.length, 6);
    assert.deepEqual(tiles[0], {
        x: 0,
        y: 0,
        coreWidth: 128,
        coreHeight: 128,
        sourceX: 0,
        sourceY: 0,
        sourceWidth: 144,
        sourceHeight: 144,
        cropX: 0,
        cropY: 0,
    });
    assert.deepEqual(tiles.at(-1), {
        x: 256,
        y: 128,
        coreWidth: 44,
        coreHeight: 52,
        sourceX: 240,
        sourceY: 112,
        sourceWidth: 60,
        sourceHeight: 68,
        cropX: 16,
        cropY: 16,
    });
});

test('creates stable WebP output names', () => {
    assert.equal(makeOutputName('pretty room.jpg', 'ai'), 'pretty room-smart-ai.webp');
    assert.equal(makeOutputName('pretty room-smart-ai.webp', 'downscale'), 'pretty room-smart-optimized.webp');
});

test('normalizes user filenames for Windows without removing Chinese', () => {
    assert.equal(
        normalizeWebpFilename('  左下角有猫猫:夜景?.jpg  '),
        '左下角有猫猫_夜景_.webp',
    );
    assert.equal(normalizeWebpFilename('CON.png'), '_CON.webp');
    assert.equal(normalizeWebpFilename('room... '), 'room.webp');
    assert.equal(normalizeWebpFilename('  '), '');
});

test('creates conflict-safe names using case-insensitive comparisons', () => {
    assert.equal(
        makeUniqueWebpFilename('Pretty Room.webp', ['pretty room.WEBP']),
        'Pretty Room-2.webp',
    );
    assert.equal(
        makeUniqueWebpFilename('夜景.webp', ['夜景.webp', '夜景-2.webp']),
        '夜景-3.webp',
    );
});

test('detects phones and tablets but not Windows touch computers', () => {
    assert.equal(isMobilePlatform({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)' }), true);
    assert.equal(isMobilePlatform({ userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9)' }), true);
    assert.equal(isMobilePlatform({ platform: 'MacIntel', maxTouchPoints: 5 }), true);
    assert.equal(isMobilePlatform({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        platform: 'Win32',
        maxTouchPoints: 10,
    }), false);
});

test('commits only when the open Backgrounds drawer is closed', () => {
    assert.equal(shouldCommitReplacement(true, false, true), true);
    assert.equal(shouldCommitReplacement(false, false, true), false);
    assert.equal(shouldCommitReplacement(true, true, true), false);
    assert.equal(shouldCommitReplacement(true, false, false), false);
    assert.equal(shouldCommitReplacement(true, false, true, true), false);
});
