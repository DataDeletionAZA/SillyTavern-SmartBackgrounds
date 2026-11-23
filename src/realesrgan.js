import * as ort from 'onnxruntime-web/webgpu';
import { buildTilePlan, RESTORATION_MODELS } from './core.js';

const TILE_SIZE = 128;
const TILE_OVERLAP = 16;
const RUNTIME_URL = new URL('../runtime/', import.meta.url).href;

let sessionPromise = null;
let loadedModelId = null;

export async function restoreIllustration(image, signal, onProgress, strength, modelId) {
    throwIfAborted(signal);
    const model = RESTORATION_MODELS[modelId];
    const { session, backend } = await getSession(modelId);
    throwIfAborted(signal);
    const { scale, alignment, minTileSize = 1 } = model;

    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = image.naturalWidth || image.width;
    sourceCanvas.height = image.naturalHeight || image.height;
    const sourceContext = sourceCanvas.getContext('2d', {
        alpha: false,
        willReadFrequently: true,
    });
    if (!sourceContext) throw new Error('Canvas 2D is unavailable');
    sourceContext.drawImage(image, 0, 0);

    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = sourceCanvas.width * scale;
    outputCanvas.height = sourceCanvas.height * scale;
    const outputContext = outputCanvas.getContext('2d', { alpha: false });
    if (!outputContext) throw new Error('Canvas 2D is unavailable');

    const tileCanvas = document.createElement('canvas');
    const tileContext = tileCanvas.getContext('2d', { alpha: false });
    if (!tileContext) throw new Error('Canvas 2D is unavailable');

    const tiles = buildTilePlan(sourceCanvas.width, sourceCanvas.height, TILE_SIZE, TILE_OVERLAP);
    for (let index = 0; index < tiles.length; index += 1) {
        throwIfAborted(signal);
        const tile = tiles[index];
        const imageData = sourceContext.getImageData(
            tile.sourceX,
            tile.sourceY,
            tile.sourceWidth,
            tile.sourceHeight,
        );
        const inputWidth = Math.max(minTileSize, Math.ceil(tile.sourceWidth / alignment) * alignment);
        const inputHeight = Math.max(minTileSize, Math.ceil(tile.sourceHeight / alignment) * alignment);
        const inputData = imageDataToNchw(imageData, inputWidth, inputHeight);
        const inputTensor = new ort.Tensor(
            'float32',
            inputData,
            [1, 3, inputHeight, inputWidth],
        );

        let outputTensor;
        try {
            const results = await session.run({
                [session.inputNames[0]]: inputTensor,
            });
            outputTensor = results[session.outputNames[0]];
            const outputData = await outputTensor.getData();
            const [, , outputHeight, outputWidth] = outputTensor.dims;
            if (outputWidth !== inputWidth * scale || outputHeight !== inputHeight * scale) {
                throw new Error(`Unexpected output size from ${model.name}`);
            }
            tileCanvas.width = outputWidth;
            tileCanvas.height = outputHeight;
            tileContext.putImageData(nchwToImageData(outputData, outputWidth, outputHeight), 0, 0);

            outputContext.drawImage(
                tileCanvas,
                tile.cropX * scale,
                tile.cropY * scale,
                tile.coreWidth * scale,
                tile.coreHeight * scale,
                tile.x * scale,
                tile.y * scale,
                tile.coreWidth * scale,
                tile.coreHeight * scale,
            );
        } finally {
            inputTensor.dispose();
            outputTensor?.dispose();
        }

        onProgress((index + 1) / tiles.length, backend);
        await nextFrame();
    }

    const detailStrength = Math.max(0, Math.min(1, Number(strength) || 0));
    if (detailStrength >= 1) return outputCanvas;

    const blendedCanvas = document.createElement('canvas');
    blendedCanvas.width = outputCanvas.width;
    blendedCanvas.height = outputCanvas.height;
    const blendedContext = blendedCanvas.getContext('2d', { alpha: false });
    if (!blendedContext) throw new Error('Canvas 2D is unavailable');
    blendedContext.imageSmoothingEnabled = true;
    blendedContext.imageSmoothingQuality = 'high';
    blendedContext.drawImage(sourceCanvas, 0, 0, blendedCanvas.width, blendedCanvas.height);
    blendedContext.globalAlpha = detailStrength;
    blendedContext.drawImage(outputCanvas, 0, 0);
    blendedContext.globalAlpha = 1;
    return blendedCanvas;
}

async function getSession(modelId) {
    if (loadedModelId !== modelId || !sessionPromise) {
        const previous = sessionPromise;
        loadedModelId = modelId;
        configureRuntime();
        sessionPromise = (async () => {
            if (previous) {
                const { session } = await previous;
                await session.release();
            }
            const modelUrl = new URL(`../models/${RESTORATION_MODELS[modelId].filename}`, import.meta.url).href;
            return await createSession(modelUrl);
        })().catch((error) => {
            sessionPromise = null;
            throw error;
        });
    }
    return await sessionPromise;
}

function configureRuntime() {
    ort.env.wasm.wasmPaths = RUNTIME_URL;
    ort.env.wasm.proxy = false;
    ort.env.wasm.numThreads = globalThis.crossOriginIsolated
        ? Math.max(1, Math.min(4, navigator.hardwareConcurrency || 4))
        : 1;
}

async function createSession(modelUrl) {
    if (navigator.gpu) {
        try {
            const session = await ort.InferenceSession.create(modelUrl, {
                executionProviders: ['webgpu'],
                preferredOutputLocation: 'cpu',
            });
            return { session, backend: 'webgpu' };
        } catch (error) {
            console.warn('[smart-backgrounds] WebGPU model startup failed; using the CPU fallback.', error);
        }
    }

    const session = await ort.InferenceSession.create(modelUrl, {
        executionProviders: ['wasm'],
    });
    return { session, backend: 'wasm' };
}

function imageDataToNchw(imageData, width, height) {
    const pixels = width * height;
    const output = new Float32Array(pixels * 3);
    for (let y = 0; y < height; y += 1) {
        const sourceRow = Math.min(y, imageData.height - 1) * imageData.width;
        for (let x = 0; x < width; x += 1) {
            const index = y * width + x;
            const source = (sourceRow + Math.min(x, imageData.width - 1)) * 4;
            output[index] = imageData.data[source] / 255;
            output[pixels + index] = imageData.data[source + 1] / 255;
            output[pixels * 2 + index] = imageData.data[source + 2] / 255;
        }
    }
    return output;
}

function nchwToImageData(data, width, height) {
    const pixels = width * height;
    const output = new ImageData(width, height);
    for (let index = 0; index < pixels; index += 1) {
        output.data[index * 4] = toByte(data[index]);
        output.data[index * 4 + 1] = toByte(data[pixels + index]);
        output.data[index * 4 + 2] = toByte(data[pixels * 2 + index]);
        output.data[index * 4 + 3] = 255;
    }
    return output;
}

function toByte(value) {
    return Math.max(0, Math.min(255, Math.round(value * 255)));
}

function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function throwIfAborted(signal) {
    if (signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
    }
}
