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
 * Split an image into overlapping tiles so restoration stays within a
 * predictable memory budget and the kept tile centers do not show seams.
 */
export function buildTilePlan(width, height, tileSize = 128, overlap = 16) {
    const tiles = [];

    for (let y = 0; y < height; y += tileSize) {
        for (let x = 0; x < width; x += tileSize) {
            const coreWidth = Math.min(tileSize, width - x);
            const coreHeight = Math.min(tileSize, height - y);
            const sourceX = Math.max(0, x - overlap);
            const sourceY = Math.max(0, y - overlap);
            const sourceRight = Math.min(width, x + coreWidth + overlap);
            const sourceBottom = Math.min(height, y + coreHeight + overlap);

            tiles.push({
                x,
                y,
                coreWidth,
                coreHeight,
                sourceX,
                sourceY,
                sourceWidth: sourceRight - sourceX,
                sourceHeight: sourceBottom - sourceY,
                cropX: x - sourceX,
                cropY: y - sourceY,
            });
        }
    }

    return tiles;
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
 * Make a readable base name for an optimized background.
 *
 * @param {string} filename
 * @param {'ai'|'downscale'|'compress'} mode
 */
export function makeOutputName(filename, mode) {
    const base = String(filename)
        .replace(/\.[^/.]+$/, '')
        .replace(/-smart-(ai|optimized)(-[a-z0-9_-]+)?$/i, '');
    const suffix = mode === 'ai' ? 'smart-ai' : 'smart-optimized';
    return `${base}-${suffix}.webp`;
}

/**
 * Give every reversible replacement its own filename. This prevents a new run
 * from overwriting an older optimized image before the user has accepted it.
 *
 * @param {string} filename
 * @param {'ai'|'downscale'|'compress'} mode
 * @param {string} transactionId
 */
export function makePendingOutputName(filename, mode, transactionId) {
    const readableName = makeOutputName(filename, mode).replace(/\.webp$/i, '');
    const safeId = String(transactionId)
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '')
        .slice(0, 16) || 'pending';
    return `${readableName}-${safeId}.webp`;
}

/**
 * A replacement is accepted only when an open Backgrounds drawer transitions
 * to closed while no replacement action is already running.
 */
export function shouldCommitReplacement(wasOpen, isOpen, hasPending, isBusy = false) {
    return Boolean(wasOpen && !isOpen && hasPending && !isBusy);
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
