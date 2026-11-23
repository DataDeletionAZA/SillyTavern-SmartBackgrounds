export const DEFAULT_SETTINGS = Object.freeze({
    maxLongEdge: 4096,
    webpQuality: 0.88,
    aiStrength: 0.4,
    aiThreshold: 2560,
    downscaleTolerance: 1.15,
});

export const DEFAULT_MODEL_ID = 'realesrgan';
export const RESTORATION_MODELS = Object.freeze({
    realesrgan: { name: 'Real-ESRGAN Anime 6B ×4', filename: 'RealESRGAN_x4plus_anime_6B.onnx', scale: 4, alignment: 1 },
    fallin: { name: 'Fallin Soft ×2', filename: 'Fallin_Soft_x2.onnx', scale: 2, alignment: 4, minTileSize: 40 },
    alchemy: { name: 'Alchemy ×4', filename: 'Alchemy_x4.onnx', scale: 4, alignment: 1 },
    apisr: { name: 'APISR ×2', filename: 'APISR_RRDB_x2.onnx', scale: 2, alignment: 2 },
});

export function getPlannedDimensions(image, plan, modelId) {
    const scale = plan.mode === 'ai' ? Math.min(plan.scale, RESTORATION_MODELS[modelId].scale) : 1;
    return fitWithinLongEdge(image.width * scale, image.height * scale, plan.targetLongEdge);
}

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
 * Normalize a user-editable WebP filename for macOS, Linux, and Windows.
 * Chinese and other Unicode characters are preserved.
 *
 * @param {string} value
 */
export function normalizeWebpFilename(value) {
    let base = String(value ?? '')
        .trim()
        .replace(/\.(avif|bmp|gif|jpe?g|png|webp)$/i, '')
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
        .replace(/[. ]+$/g, '')
        .trim()
        .slice(0, 160);

    if (!base) return '';
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base)) {
        base = `_${base}`;
    }

    return `${base}.webp`;
}

/**
 * Make a filename unique without relying on case-sensitive filesystem rules.
 * This matters on most Windows installations and on default macOS volumes.
 *
 * @param {string} preferredName
 * @param {Iterable<string>} existingNames
 */
export function makeUniqueWebpFilename(preferredName, existingNames) {
    const normalized = normalizeWebpFilename(preferredName);
    if (!normalized) return '';

    const occupied = new Set(
        Array.from(existingNames ?? [], value => String(value).toLocaleLowerCase()),
    );
    if (!occupied.has(normalized.toLocaleLowerCase())) return normalized;

    const base = normalized.replace(/\.webp$/i, '');
    for (let index = 2; index < 10_000; index++) {
        const candidate = `${base}-${index}.webp`;
        if (!occupied.has(candidate.toLocaleLowerCase())) return candidate;
    }

    return `${base}-${Date.now()}.webp`;
}

/**
 * Detect phones and tablets without treating Windows touch-screen computers as
 * mobile devices.
 *
 * @param {{userAgent?:string, userAgentDataMobile?:boolean, platform?:string, maxTouchPoints?:number}} platform
 */
export function isMobilePlatform(platform = {}) {
    if (platform.userAgentDataMobile === true) return true;
    if (/Android|iPhone|iPad|iPod|Mobile/i.test(String(platform.userAgent ?? ''))) return true;
    return platform.platform === 'MacIntel' && Number(platform.maxTouchPoints) > 1;
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
