import * as ort from 'onnxruntime-web/webgpu';
import { buildTilePlan } from './core.js';

const MODEL_SCALE = 4;
const TILE_SIZE = 128;
const TILE_OVERLAP = 16;
const MODEL_URL = new URL('../models/RealESRGAN_x4plus_anime_6B.onnx', import.meta.url).href;
const RUNTIME_URL = new URL('../runtime/', import.meta.url).href;

let sessionPromise = null;
let sessionBackend = 'wasm';

export async function restoreIllustration(image, signal, onProgress, strength = 0.4) {
    throwIfAborted(signal);
    const session = await getSession();
    throwIfAborted(signal);

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
    outputCanvas.width = sourceCanvas.width * MODEL_SCALE;
    outputCanvas.height = sourceCanvas.height * MODEL_SCALE;
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
        const inputData = imageDataToNchw(imageData);
        const inputTensor = new ort.Tensor(
            'float32',
            inputData,
            [1, 3, tile.sourceHeight, tile.sourceWidth],
        );

        let outputTensor;
        try {
            const results = await session.run({
                [session.inputNames[0]]: inputTensor,
            });
            outputTensor = results[session.outputNames[0]];
            const outputData = await outputTensor.getData();
            const [, , outputHeight, outputWidth] = outputTensor.dims;
            tileCanvas.width = outputWidth;
            tileCanvas.height = outputHeight;
            tileContext.putImageData(nchwToImageData(outputData, outputWidth, outputHeight), 0, 0);

            outputContext.drawImage(
                tileCanvas,
                tile.cropX * MODEL_SCALE,
                tile.cropY * MODEL_SCALE,
                tile.coreWidth * MODEL_SCALE,
                tile.coreHeight * MODEL_SCALE,
                tile.x * MODEL_SCALE,
                tile.y * MODEL_SCALE,
                tile.coreWidth * MODEL_SCALE,
                tile.coreHeight * MODEL_SCALE,
            );
        } finally {
            inputTensor.dispose();
            outputTensor?.dispose();
        }

        onProgress((index + 1) / tiles.length, sessionBackend);
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

async function getSession() {
    if (!sessionPromise) {
        configureRuntime();
        sessionPromise = createSession().catch((error) => {
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

async function createSession() {
    if (navigator.gpu) {
        try {
            sessionBackend = 'webgpu';
            return await ort.InferenceSession.create(MODEL_URL, {
                executionProviders: ['webgpu'],
                preferredOutputLocation: 'cpu',
            });
        } catch (error) {
            console.warn('[smart-backgrounds] WebGPU model startup failed; using the CPU fallback.', error);
        }
    }

    sessionBackend = 'wasm';
    return await ort.InferenceSession.create(MODEL_URL, {
        executionProviders: ['wasm'],
    });
}

function imageDataToNchw(imageData) {
    const pixels = imageData.width * imageData.height;
    const output = new Float32Array(pixels * 3);
    for (let index = 0; index < pixels; index += 1) {
        output[index] = imageData.data[index * 4] / 255;
        output[pixels + index] = imageData.data[index * 4 + 1] / 255;
        output[pixels * 2 + index] = imageData.data[index * 4 + 2] / 255;
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
