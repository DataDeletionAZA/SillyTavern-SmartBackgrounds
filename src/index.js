import * as tf from '@tensorflow/tfjs';
import Upscaler from 'upscaler';
import x2Model from '@upscalerjs/esrgan-slim/2x';
import x3Model from '@upscalerjs/esrgan-slim/3x';
import x4Model from '@upscalerjs/esrgan-slim/4x';

import { getRequestHeaders, getThumbnailUrl } from '/script.js';
import { getBackgroundPath, getBackgrounds } from '/scripts/backgrounds.js';
import { t } from '/scripts/i18n.js';
import { Popup, POPUP_RESULT, POPUP_TYPE } from '/scripts/popup.js';

import {
    DEFAULT_SETTINGS,
    classifyImage,
    decodedMemoryMiB,
    fitWithinLongEdge,
    formatBytes,
    makeOutputName,
} from './core.js';

const MODULE_ID = 'smart-backgrounds';
const ACTION = 'smart-background-optimize';
const MODEL_DEFINITIONS = { 2: x2Model, 3: x3Model, 4: x4Model };
const MODEL_PATCHES = { 2: 128, 3: 96, 4: 64 };
let galleryObserver = null;
let activeAbortController = null;
let initialized = false;

function modelPath(scale) {
    return new URL(`../models/x${scale}/model.json`, import.meta.url).href;
}

function addHeaderButton() {
    if (document.getElementById('smart_backgrounds_open')) return;
    const uploadButton = document.getElementById('add_background_button_top');
    if (!uploadButton) {
        console.warn(`[${MODULE_ID}] Background header was not found; the per-image action remains available.`);
        return;
    }

    const button = document.createElement('button');
    button.id = 'smart_backgrounds_open';
    button.type = 'button';
    button.className = 'menu_button menu_button_icon';
    button.title = t`Optimize the selected background`;
    button.innerHTML = `
        <i class="fa-solid fa-wand-magic-sparkles"></i>
        <span>${escapeHtml(t`Smart Optimize`)}</span>
    `;
    button.addEventListener('click', onHeaderButtonClick);
    uploadButton.insertAdjacentElement('beforebegin', button);
}

function decorateBackgroundTiles(root = document) {
    const tiles = root.querySelectorAll?.('#bg_menu_content .bg_example:not([custom="true"])') || [];
    for (const tile of tiles) {
        const menu = tile.querySelector('.jg-menu');
        if (!menu || menu.querySelector(`[data-action="${ACTION}"]`)) continue;

        const action = document.createElement('div');
        action.dataset.action = ACTION;
        action.className = 'jg-button smart-backgrounds-action fa-solid fa-wand-magic-sparkles fa-fw pointer';
        action.title = t`Smart optimize this background`;
        action.setAttribute('aria-label', t`Smart optimize this background`);
        menu.insertBefore(action, menu.firstChild);
    }
}

function observeGallery() {
    const gallery = document.getElementById('bg_menu_content');
    if (!gallery || galleryObserver) return;

    galleryObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node instanceof Element) {
                    decorateBackgroundTiles(node.parentElement || node);
                }
            }
        }
    });
    galleryObserver.observe(gallery, { childList: true, subtree: true });
    decorateBackgroundTiles(gallery);
}

async function onHeaderButtonClick() {
    const selected = document.querySelector('#bg_menu_content .bg_example.selected-background');
    const fallback = document.querySelector('#bg_menu_content .bg_example[bgfile]');
    const tile = selected || fallback;
    const filename = tile?.getAttribute('bgfile');

    if (!filename) {
        toastr.warning(t`Please select a global background first.`);
        return;
    }

    if (tile.getAttribute('animated') === 'true') {
        toastr.warning(t`Animated backgrounds are not supported yet.`);
        return;
    }

    if (!selected) {
        toastr.info(t`No background was selected, so the first visible background was opened.`);
    }
    await openOptimizer(filename);
}

function onDocumentClick(event) {
    const action = event.target.closest?.(`[data-action="${ACTION}"]`);
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();

    const tile = action.closest('.bg_example');
    const filename = tile?.getAttribute('bgfile');
    if (tile?.getAttribute('animated') === 'true') {
        toastr.warning(t`Animated backgrounds are not supported yet.`);
        return;
    }
    if (filename) {
        void openOptimizer(filename);
    }
}

async function openOptimizer(filename) {
    if (activeAbortController) {
        toastr.warning(t`Another background is currently being processed.`);
        return;
    }

    let analysis;
    try {
        analysis = await analyzeBackground(filename);
    } catch (error) {
        console.error(`[${MODULE_ID}] Failed to inspect background`, error);
        toastr.error(t`The background could not be opened.`);
        return;
    }

    const plan = classifyImage(analysis, DEFAULT_SETTINGS);
    const content = buildAnalysisView(analysis, plan);
    const popup = new Popup(content, POPUP_TYPE.CONFIRM, '', {
        wide: true,
        large: true,
        allowVerticalScrolling: true,
        okButton: t`Start processing`,
        cancelButton: t`Cancel`,
    });

    const result = await popup.show();
    if (result !== POPUP_RESULT.AFFIRMATIVE) {
        URL.revokeObjectURL(analysis.objectUrl);
        return;
    }

    await processBackground(analysis, plan);
}

async function analyzeBackground(filename) {
    const response = await fetch(`/backgrounds/${encodeURIComponent(filename)}`, {
        method: 'GET',
        cache: 'no-store',
    });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    try {
        const image = await loadImage(objectUrl);
        return {
            filename,
            blob,
            objectUrl,
            width: image.naturalWidth,
            height: image.naturalHeight,
            bytes: blob.size,
            mime: blob.type,
        };
    } catch (error) {
        URL.revokeObjectURL(objectUrl);
        throw error;
    }
}

function buildAnalysisView(analysis, plan) {
    const content = document.createElement('div');
    content.className = 'smart-backgrounds-dialog';

    const preview = document.createElement('div');
    preview.className = 'smart-backgrounds-preview';
    const image = document.createElement('img');
    image.src = analysis.objectUrl;
    image.alt = analysis.filename;
    preview.appendChild(image);

    const details = document.createElement('div');
    details.className = 'smart-backgrounds-details';
    const title = document.createElement('h3');
    title.textContent = t`Smart Background Analysis`;

    const badge = document.createElement('div');
    badge.className = `smart-backgrounds-plan smart-backgrounds-plan-${plan.mode}`;
    badge.innerHTML = `<i class="${planIcon(plan.mode)}"></i><span>${escapeHtml(planTitle(plan))}</span>`;

    const target = fitWithinLongEdge(
        analysis.width * (plan.mode === 'ai' ? plan.scale : 1),
        analysis.height * (plan.mode === 'ai' ? plan.scale : 1),
        plan.targetLongEdge,
    );

    const info = document.createElement('dl');
    info.className = 'smart-backgrounds-info';
    appendInfo(info, t`File`, analysis.filename);
    appendInfo(info, t`Original size`, `${analysis.width} × ${analysis.height}`);
    appendInfo(info, t`File size`, formatBytes(analysis.bytes));
    appendInfo(info, t`Decoded memory`, `≈ ${decodedMemoryMiB(analysis.width, analysis.height).toFixed(0)} MB`);
    appendInfo(info, t`Planned output`, `${target.width} × ${target.height} WebP`);

    const explanation = document.createElement('p');
    explanation.className = 'smart-backgrounds-explanation';
    explanation.textContent = planExplanation(plan);

    const safety = document.createElement('div');
    safety.className = 'smart-backgrounds-safety';
    safety.innerHTML = `
        <i class="fa-solid fa-shield-heart"></i>
        <span>${escapeHtml(t`The original file will be kept. A new optimized copy will be added to your background library.`)}</span>
    `;

    details.append(title, badge, info, explanation, safety);
    content.append(preview, details);
    return content;
}

function appendInfo(list, label, value) {
    const term = document.createElement('dt');
    term.textContent = label;
    const description = document.createElement('dd');
    description.textContent = value;
    list.append(term, description);
}

function planTitle(plan) {
    if (plan.mode === 'ai') return t`Local AI enhancement ×${plan.scale}`;
    if (plan.mode === 'downscale') return t`High-resolution performance optimization`;
    return t`Loss-conscious compression`;
}

function planIcon(mode) {
    if (mode === 'ai') return 'fa-solid fa-sparkles';
    if (mode === 'downscale') return 'fa-solid fa-gauge-high';
    return 'fa-solid fa-box-archive';
}

function planExplanation(plan) {
    if (plan.mode === 'ai') {
        return t`This image is smaller than the recommended background size. A compact ESRGAN model will enhance it locally in small tiles, then fit it to a maximum long edge of 4096 pixels.`;
    }
    if (plan.mode === 'downscale') {
        return t`This image contains far more pixels than the screen needs. It will be resized to a 4096-pixel long edge without running AI.`;
    }
    return t`The dimensions are already suitable. The image will keep its size and be saved as a high-quality WebP copy.`;
}

async function processBackground(analysis, plan) {
    activeAbortController = new AbortController();
    let progressCanClose = false;
    const progress = buildProgressView(analysis.filename, plan);
    const progressPopup = new Popup(progress.root, POPUP_TYPE.DISPLAY, '', {
        large: false,
        allowEscapeClose: false,
        onClosing: () => progressCanClose || !activeAbortController,
    });
    progress.cancel.addEventListener('click', () => activeAbortController?.abort());

    const popupPromise = progressPopup.show();
    try {
        updateProgress(progress, t`Preparing image…`, 0.03);
        let sourceUrl = analysis.objectUrl;
        let sourceImage = null;

        if (plan.mode === 'ai') {
            sourceUrl = await upscaleLocally(
                analysis.objectUrl,
                plan.scale,
                activeAbortController.signal,
                (value) => updateProgress(progress, t`Enhancing with local AI…`, 0.08 + value * 0.72),
            );
        }

        throwIfAborted(activeAbortController.signal);
        updateProgress(progress, t`Creating the optimized background…`, 0.84);
        sourceImage = await loadImage(sourceUrl);
        const target = fitWithinLongEdge(
            sourceImage.naturalWidth,
            sourceImage.naturalHeight,
            plan.targetLongEdge,
        );
        const outputBlob = await renderWebp(sourceImage, target, DEFAULT_SETTINGS.webpQuality);

        throwIfAborted(activeAbortController.signal);
        updateProgress(progress, t`Adding the new background to SillyTavern…`, 0.93);
        const outputName = makeOutputName(analysis.filename, plan.mode);
        const uploadedName = await uploadBackground(outputBlob, outputName);

        await refreshAndSelectUploadedBackground(uploadedName, analysis.filename);
        updateProgress(progress, t`Finished`, 1);
        toastr.success(t`Optimized background created: ${uploadedName}`);
        progressCanClose = true;
        await progressPopup.complete(POPUP_RESULT.AFFIRMATIVE);
    } catch (error) {
        if (error?.name === 'AbortError') {
            toastr.info(t`Background processing was cancelled.`);
        } else {
            console.error(`[${MODULE_ID}] Background processing failed`, error);
            toastr.error(t`Background processing failed. The original file was not changed.`);
        }
        progressCanClose = true;
        await progressPopup.complete(POPUP_RESULT.CANCELLED);
    } finally {
        URL.revokeObjectURL(analysis.objectUrl);
        activeAbortController = null;
        await popupPromise;
    }
}

function buildProgressView(filename, plan) {
    const root = document.createElement('div');
    root.className = 'smart-backgrounds-progress';
    root.innerHTML = `
        <i class="fa-solid fa-wand-magic-sparkles smart-backgrounds-progress-icon"></i>
        <h3>${escapeHtml(planTitle(plan))}</h3>
        <div class="smart-backgrounds-progress-file">${escapeHtml(filename)}</div>
        <div class="smart-backgrounds-progress-track">
            <div class="smart-backgrounds-progress-bar"></div>
        </div>
        <div class="smart-backgrounds-progress-label">${escapeHtml(t`Preparing image…`)}</div>
    `;
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'menu_button';
    cancel.innerHTML = `<i class="fa-solid fa-ban"></i><span>${escapeHtml(t`Cancel processing`)}</span>`;
    root.appendChild(cancel);
    return {
        root,
        cancel,
        bar: root.querySelector('.smart-backgrounds-progress-bar'),
        label: root.querySelector('.smart-backgrounds-progress-label'),
    };
}

function updateProgress(progress, label, value) {
    const percentage = Math.max(0, Math.min(100, Math.round(value * 100)));
    progress.bar.style.width = `${percentage}%`;
    progress.label.textContent = `${label} ${percentage}%`;
}

async function upscaleLocally(imageUrl, scale, signal, onProgress) {
    const backend = await selectTensorflowBackend();
    console.info(`[${MODULE_ID}] Local AI backend: ${backend}; scale: ${scale}x`);

    const baseModel = MODEL_DEFINITIONS[scale];
    const model = {
        ...baseModel,
        path: modelPath(scale),
    };
    const upscaler = new Upscaler({ model });
    const patchSize = MODEL_PATCHES[scale];

    try {
        await upscaler.warmup({ patchSize, padding: 4 }, { signal });
        return await upscaler.upscale(imageUrl, {
            output: 'base64',
            patchSize,
            padding: 4,
            signal,
            awaitNextFrame: true,
            progress: (percent) => onProgress(percent),
        });
    } finally {
        await upscaler.dispose();
    }
}

async function selectTensorflowBackend() {
    if (tf.findBackend('webgl')) {
        await tf.setBackend('webgl');
        await tf.ready();
        return 'webgl';
    }

    await tf.setBackend('cpu');
    await tf.ready();
    return 'cpu';
}

async function renderWebp(image, dimensions, quality) {
    const canvas = document.createElement('canvas');
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('Canvas 2D is unavailable');

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, dimensions.width, dimensions.height);

    return await new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => blob ? resolve(blob) : reject(new Error('WebP encoding failed')),
            'image/webp',
            quality,
        );
    });
}

async function uploadBackground(blob, filename) {
    const formData = new FormData();
    formData.append('avatar', new File([blob], filename, { type: 'image/webp' }));
    const response = await fetch('/api/backgrounds/upload', {
        method: 'POST',
        headers: getRequestHeaders({ omitContentType: true }),
        body: formData,
        cache: 'no-cache',
    });
    if (!response.ok) {
        throw new Error(`Upload failed: HTTP ${response.status}`);
    }
    return await response.text();
}

function selectUploadedBackground(filename) {
    const tiles = document.querySelectorAll('#bg_menu_content .bg_example[bgfile]');
    const tile = Array.from(tiles).find((element) => element.getAttribute('bgfile') === filename);
    if (!tile) return false;
    tile.click();
    return true;
}

async function refreshAndSelectUploadedBackground(filename, sourceFilename) {
    await getBackgrounds();
    if (selectUploadedBackground(filename)) {
        return true;
    }

    // On some ST installations the background list endpoint briefly returns its
    // previous result after an upload. Add a normal-looking temporary tile so the
    // user can use the new background immediately; a later refresh replaces it
    // with ST's own tile.
    const inserted = insertTemporaryGalleryTile(filename, sourceFilename);
    if (inserted) {
        selectUploadedBackground(filename);
    }

    window.setTimeout(async () => {
        try {
            await getBackgrounds();
            if (!selectUploadedBackground(filename)) {
                insertTemporaryGalleryTile(filename, sourceFilename);
                selectUploadedBackground(filename);
            }
        } catch (error) {
            console.warn(`[${MODULE_ID}] Deferred gallery refresh failed.`, error);
        }
    }, 5000);

    return inserted;
}

function insertTemporaryGalleryTile(filename, sourceFilename) {
    if (document.querySelector(`#bg_menu_content .bg_example[bgfile="${CSS.escape(filename)}"]`)) {
        return true;
    }

    const gallery = document.getElementById('bg_menu_content');
    const source = document.querySelector(`#bg_menu_content .bg_example[bgfile="${CSS.escape(sourceFilename)}"]`)
        || gallery?.querySelector('.bg_example');
    if (!gallery || !source) {
        return false;
    }

    const tile = source.cloneNode(true);
    tile.classList.remove('selected-background', 'locked-background', 'mobile-menu-open');
    tile.setAttribute('bgfile', filename);
    tile.setAttribute('title', filename);
    tile.setAttribute('custom', 'false');
    tile.setAttribute('animated', 'false');

    const clipper = tile.querySelector('.thumbnail-clipper');
    if (clipper) {
        clipper.classList.remove('lazy-load-background');
        clipper.style.backgroundImage = `url("${getThumbnailUrl('bg', filename, true)}")`;
    }

    const title = tile.querySelector('.BGSampleTitle');
    if (title) {
        title.textContent = filename.replace(/\.[^.]+$/, '');
    }

    window.jQuery?.(tile).data('url', `url("${getBackgroundPath(filename)}")`);
    gallery.prepend(tile);
    decorateBackgroundTiles(gallery);
    return true;
}

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.decoding = 'async';
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Image decode failed'));
        image.src = src;
    });
}

function throwIfAborted(signal) {
    if (signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
    }
}

function escapeHtml(value) {
    const element = document.createElement('span');
    element.textContent = String(value);
    return element.innerHTML;
}

export async function init() {
    if (initialized) return;
    initialized = true;

    addHeaderButton();
    observeGallery();
    document.addEventListener('click', onDocumentClick, true);
    console.info(`[${MODULE_ID}] Smart Backgrounds initialized for SillyTavern 1.18.0+.`);
}
