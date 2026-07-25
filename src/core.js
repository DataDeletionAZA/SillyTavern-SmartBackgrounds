export const DEFAULT_SETTINGS = Object.freeze({
    maxLongEdge: 4096,
    webpQuality: 0.88,
    aiThreshold: 2560,
    downscaleTolerance: 1.15,
});

/**
 * Decide how a background should be processed.
 *
 * @param {{width:number, height:number, bytes:number}} image
 * @param {typeof DEFAULT_SETTINGS} settings
 */
export function classifyImage(image, settings = DEFAULT_SETTINGS) {
    const longEdge = Math.max(image.width, image.height);
    const targetEdge = settings.maxLongEdge;

    if (longEdge < settings.aiThreshold) {
        const scale = chooseAiScale(longEdge, targetEdge);
        return {
            mode: 'ai',
            scale,
            targetLongEdge: Math.min(longEdge * scale, targetEdge),
        };
    }

    if (longEdge > targetEdge * settings.downscaleTolerance) {
        return {
            mode: 'downscale',
            scale: 1,
            targetLongEdge: targetEdge,
        };
    }

    return {
        mode: 'compress',
        scale: 1,
        targetLongEdge: Math.min(longEdge, targetEdge),
    };
}

/**
 * Prefer a single AI pass and cap the final canvas afterwards.
 *
 * @param {number} longEdge
 * @param {number} targetEdge
 */
export function chooseAiScale(longEdge, targetEdge) {
    const required = targetEdge / Math.max(1, longEdge);
    if (required > 3) return 4;
    if (required > 2) return 3;
    return 2;
}

/**
 * Preserve aspect ratio while targeting a maximum long edge.
 *
 * @param {number} width
 * @param {number} height
 * @param {number} targetLongEdge
 */
export function fitWithinLongEdge(width, height, targetLongEdge) {
    const longEdge = Math.max(width, height);
    if (longEdge <= targetLongEdge) {
        return { width, height };
    }

    const ratio = targetLongEdge / longEdge;
    return {
        width: Math.max(1, Math.round(width * ratio)),
        height: Math.max(1, Math.round(height * ratio)),
    };
}

/**
 * Make a stable output name so reprocessing replaces the previous optimized copy.
 *
 * @param {string} filename
 * @param {'ai'|'downscale'|'compress'} mode
 */
export function makeOutputName(filename, mode) {
    const base = String(filename)
        .replace(/\.[^/.]+$/, '')
        .replace(/-smart-(ai|optimized)$/i, '');
    const suffix = mode === 'ai' ? 'smart-ai' : 'smart-optimized';
    return `${base}-${suffix}.webp`;
}

export function decodedMemoryMiB(width, height) {
    return width * height * 4 / 1024 / 1024;
}

export function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / (1024 ** index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}
