import { getRequestHeaders, getThumbnailUrl } from '/script.js';
import { getBackgroundPath, getBackgrounds } from '/scripts/backgrounds.js';
import { t } from '/scripts/i18n.js';
import { Popup, POPUP_RESULT, POPUP_TYPE } from '/scripts/popup.js';

import {
    DEFAULT_SETTINGS,
    classifyImage,
    fitWithinLongEdge,
    formatBytes,
    isMobilePlatform,
    makeOutputName,
    makeUniqueWebpFilename,
    normalizeWebpFilename,
    shouldCommitReplacement,
} from './core.js';
import { restoreIllustration } from './realesrgan.js';

const MODULE_ID = 'smart-backgrounds';
const ACTION = 'smart-background-optimize';
const UNDO_ACTION = 'smart-background-undo';
let galleryObserver = null;
let drawerObserver = null;
let activeAbortController = null;
const pendingReplacements = new Map();
let replacementActionBusy = false;
let backgroundDrawerWasOpen = false;
const deletedBackgroundsThisSession = new Set();
let initialized = false;

function addHeaderButton() {
    const uploadButton = document.getElementById('add_background_button_top');
    if (!uploadButton) {
        console.warn(`[${MODULE_ID}] Background header was not found; the per-image action remains available.`);
        return;
    }

    if (!document.getElementById('smart_backgrounds_open')) {
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

    if (!document.getElementById('smart_backgrounds_batch')) {
        const button = document.createElement('button');
        button.id = 'smart_backgrounds_batch';
        button.type = 'button';
        button.className = 'menu_button menu_button_icon';
        button.title = t`Optimize several backgrounds`;
        button.innerHTML = `
            <i class="fa-solid fa-layer-group"></i>
            <span>${escapeHtml(t`Batch Optimize`)}</span>
        `;
        button.addEventListener('click', () => void openBatchOptimizer());
        uploadButton.insertAdjacentElement('beforebegin', button);
    }
}

function addPendingReplacementBanner() {
    if (document.getElementById('smart_backgrounds_pending')) return;
    const header = document.getElementById('bg-header-fixed');
    if (!header) {
        console.warn(`[${MODULE_ID}] Background header was not found; the undo banner could not be added.`);
        return;
    }

    const banner = document.createElement('div');
    banner.id = 'smart_backgrounds_pending';
    banner.className = 'smart-backgrounds-pending';
    banner.hidden = true;
    banner.innerHTML = `
        <i class="fa-solid fa-clock-rotate-left smart-backgrounds-pending-icon" aria-hidden="true"></i>
        <div class="smart-backgrounds-pending-copy">
            <strong></strong>
            <span>${escapeHtml(t`Use the undo button on a processed image to restore only that original. Originals are deleted after Backgrounds is closed.`)}</span>
        </div>
    `;
    header.insertAdjacentElement('afterend', banner);
}

function updatePendingReplacementUi() {
    const banner = document.getElementById('smart_backgrounds_pending');
    if (banner) {
        const count = pendingReplacements.size;
        banner.hidden = count === 0;
        banner.querySelector('strong').textContent = count === 1
            ? t`1 replacement is awaiting confirmation`
            : `${count} ${t`replacements are awaiting confirmation`}`;
        banner.title = Array.from(
            pendingReplacements.values(),
            replacement => `${replacement.originalFilename} → ${replacement.outputFilename}`,
        ).join('\n');
    }
    decorateBackgroundTiles(document);
}

function applyPendingGalleryState() {
    const originals = new Set(Array.from(
        pendingReplacements.values(),
        replacement => replacement.originalFilename,
    ));
    const tiles = document.querySelectorAll('#bg_menu_content .bg_example[bgfile]');
    for (const tile of tiles) {
        const filename = tile.getAttribute('bgfile');
        if (filename && deletedBackgroundsThisSession.has(filename)) {
            tile.remove();
            continue;
        }
        tile.classList.toggle(
            'smart-backgrounds-pending-original',
            originals.has(filename),
        );
        tile.classList.toggle(
            'smart-backgrounds-pending-output',
            pendingReplacements.has(filename),
        );
    }
}

function decorateBackgroundTiles(root = document) {
    const tiles = root.querySelectorAll?.('#bg_menu_content .bg_example:not([custom="true"])') || [];
    for (const tile of tiles) {
        const menu = tile.querySelector('.jg-menu');
        const filename = tile.getAttribute('bgfile');
        if (!menu || !filename) continue;

        const action = menu.querySelector(`[data-action="${ACTION}"]`);
        const undo = menu.querySelector(`[data-action="${UNDO_ACTION}"]`);
        if (pendingReplacements.has(filename)) {
            action?.remove();
            if (!undo) {
                const itemUndo = document.createElement('div');
                itemUndo.dataset.action = UNDO_ACTION;
                itemUndo.className = 'jg-button smart-backgrounds-undo-action fa-solid fa-rotate-left fa-fw pointer';
                itemUndo.title = t`Undo only this replacement`;
                itemUndo.setAttribute('aria-label', t`Undo only this replacement`);
                itemUndo.setAttribute('aria-disabled', String(replacementActionBusy));
                menu.insertBefore(itemUndo, menu.firstChild);
            } else {
                undo.setAttribute('aria-disabled', String(replacementActionBusy));
            }
        } else {
            undo?.remove();
            if (!action) {
                const itemAction = document.createElement('div');
                itemAction.dataset.action = ACTION;
                itemAction.className = 'jg-button smart-backgrounds-action fa-solid fa-wand-magic-sparkles fa-fw pointer';
                itemAction.title = t`Smart optimize this background`;
                itemAction.setAttribute('aria-label', t`Smart optimize this background`);
                menu.insertBefore(itemAction, menu.firstChild);
            }
        }
    }
    applyPendingGalleryState();
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
    const undo = event.target.closest?.(`[data-action="${UNDO_ACTION}"]`);
    if (undo) {
        event.preventDefault();
        event.stopPropagation();
        const filename = undo.closest('.bg_example')?.getAttribute('bgfile');
        if (filename) void undoPendingReplacement(filename);
        return;
    }

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
    if (isPendingFilename(filename)) {
        toastr.warning(t`This image already has a replacement awaiting confirmation. Choose another background or undo this one first.`);
        return;
    }
    if (isCurrentDeviceMobile()) {
        toastr.warning(t`Processing is disabled on phones and tablets to protect the browser from running out of memory. You can still use backgrounds processed on a computer.`);
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
    const view = buildAnalysisView(analysis, plan);
    const popup = new Popup(view.content, POPUP_TYPE.CONFIRM, '', {
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

    await processBackground(analysis, plan, view.strengthInput
        ? Number(view.strengthInput.value) / 100
        : DEFAULT_SETTINGS.aiStrength);
}

async function openBatchOptimizer() {
    if (activeAbortController) {
        toastr.warning(t`Another background is currently being processed.`);
        return;
    }
    if (isCurrentDeviceMobile()) {
        toastr.warning(t`Processing is disabled on phones and tablets to protect the browser from running out of memory. You can still use backgrounds processed on a computer.`);
        return;
    }

    const candidates = getBatchCandidates();
    if (!candidates.length) {
        toastr.warning(t`There are no unprocessed static backgrounds available.`);
        return;
    }

    const selection = await chooseBatchBackgrounds(candidates);
    if (!selection) return;
    await processBatch(selection.filenames, selection.aiStrength);
}

function getBatchCandidates() {
    const candidates = new Map();
    const tiles = document.querySelectorAll('#bg_menu_content .bg_example[bgfile]:not([custom="true"])');
    for (const tile of tiles) {
        const filename = tile.getAttribute('bgfile');
        if (!filename || tile.getAttribute('animated') === 'true' || isPendingFilename(filename)) continue;
        candidates.set(filename, {
            filename,
            thumbnail: getThumbnailUrl('bg', filename, true),
        });
    }
    return Array.from(candidates.values());
}

async function chooseBatchBackgrounds(candidates) {
    const content = document.createElement('div');
    content.className = 'smart-backgrounds-batch';
    const title = document.createElement('h3');
    title.textContent = t`Choose backgrounds to optimize`;
    const note = document.createElement('p');
    note.textContent = t`Images are processed one at a time to limit memory use. Results can be undone separately before Backgrounds is closed.`;

    const toolbar = document.createElement('div');
    toolbar.className = 'smart-backgrounds-batch-toolbar';
    const selectAll = document.createElement('button');
    selectAll.type = 'button';
    selectAll.className = 'menu_button';
    selectAll.textContent = t`Select all`;
    const clearAll = document.createElement('button');
    clearAll.type = 'button';
    clearAll.className = 'menu_button';
    clearAll.textContent = t`Clear selection`;
    const count = document.createElement('span');
    count.textContent = t`0 selected`;
    toolbar.append(selectAll, clearAll, count);

    const list = document.createElement('div');
    list.className = 'smart-backgrounds-batch-grid';
    for (const candidate of candidates) {
        const label = document.createElement('label');
        label.className = 'smart-backgrounds-batch-item';
        label.title = candidate.filename;
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = candidate.filename;
        const image = document.createElement('img');
        image.src = candidate.thumbnail;
        image.alt = '';
        image.loading = 'lazy';
        const name = document.createElement('span');
        name.textContent = candidate.filename;
        label.append(checkbox, image, name);
        list.append(label);
    }

    const updateCount = () => {
        const selectedCount = list.querySelectorAll('input:checked').length;
        count.textContent = `${selectedCount} ${t`selected`}`;
    };
    list.addEventListener('change', updateCount);
    selectAll.addEventListener('click', () => {
        for (const checkbox of list.querySelectorAll('input')) checkbox.checked = true;
        updateCount();
    });
    clearAll.addEventListener('click', () => {
        for (const checkbox of list.querySelectorAll('input')) checkbox.checked = false;
        updateCount();
    });

    const strength = buildStrengthControl();
    content.append(title, note, toolbar, list, strength.root);
    let filenames = [];
    const popup = new Popup(content, POPUP_TYPE.CONFIRM, '', {
        large: true,
        allowVerticalScrolling: true,
        okButton: t`Start batch processing`,
        cancelButton: t`Cancel`,
        onClosing: closingPopup => {
            if (closingPopup.result !== POPUP_RESULT.AFFIRMATIVE) return true;
            filenames = Array.from(list.querySelectorAll('input:checked'), input => input.value);
            if (filenames.length) return true;
            toastr.warning(t`Choose at least one background.`);
            return false;
        },
    });
    popup.dlg.classList.add('smart-backgrounds-batch-popup');
    const result = await popup.show();
    if (result !== POPUP_RESULT.AFFIRMATIVE) return null;
    return {
        filenames,
        aiStrength: Number(strength.input.value) / 100,
    };
}

async function processBatch(filenames, aiStrength) {
    activeAbortController = new AbortController();
    let progressCanClose = false;
    const progress = buildProgressView('', t`Batch Optimize`);
    const progressPopup = new Popup(progress.root, POPUP_TYPE.DISPLAY, '', {
        large: false,
        allowEscapeClose: false,
        onClosing: () => progressCanClose || !activeAbortController,
    });
    progressPopup.dlg.classList.add('smart-backgrounds-progress-popup');
    progress.cancel.addEventListener('click', () => {
        if (!activeAbortController || activeAbortController.signal.aborted) return;
        progress.cancel.disabled = true;
        progress.cancel.querySelector('span').textContent = t`Cancelling…`;
        activeAbortController.abort();
    });

    const popupPromise = progressPopup.show();
    const occupiedNames = new Set(getGalleryBackgroundNames());
    const completed = [];
    let failed = 0;
    try {
        for (let index = 0; index < filenames.length; index += 1) {
            throwIfAborted(activeAbortController.signal);
            const filename = filenames[index];
            let analysis = null;
            try {
                updateProgress(progress, `${index + 1}/${filenames.length} · ${filename}`, index / filenames.length);
                analysis = await analyzeBackground(filename);
                const plan = classifyImage(analysis, DEFAULT_SETTINGS);
                const result = await createOptimizedBackground(
                    analysis,
                    plan,
                    activeAbortController.signal,
                    aiStrength,
                    (label, value) => updateProgress(
                        progress,
                        `${index + 1}/${filenames.length} · ${label}`,
                        (index + value) / filenames.length,
                    ),
                );
                throwIfAborted(activeAbortController.signal);
                const outputName = makeUniqueWebpFilename(
                    makeOutputName(filename, plan.mode),
                    occupiedNames,
                );
                const uploadedName = await uploadBackground(result.blob, outputName);
                occupiedNames.add(uploadedName);
                pendingReplacements.set(uploadedName, {
                    originalFilename: filename,
                    outputFilename: uploadedName,
                });
                completed.push({ originalFilename: filename, outputFilename: uploadedName });
            } catch (error) {
                if (error?.name === 'AbortError') throw error;
                failed += 1;
                console.error(`[${MODULE_ID}] Batch item failed: ${filename}`, error);
            } finally {
                if (analysis) URL.revokeObjectURL(analysis.objectUrl);
            }
        }

        if (completed.length) {
            await refreshCompletedBatch(completed);
            toastr.success(t`Batch processing finished. Each result can be undone separately.`);
        }
        if (failed) toastr.warning(t`Some backgrounds could not be processed. Their originals were not changed.`);
        updateProgress(progress, t`Finished`, 1);
        progressCanClose = true;
        await progressPopup.complete(POPUP_RESULT.AFFIRMATIVE);
    } catch (error) {
        if (completed.length) {
            try {
                await refreshCompletedBatch(completed);
            } catch (refreshError) {
                console.warn(`[${MODULE_ID}] Finished batch items could not be shown immediately.`, refreshError);
            }
        }
        if (error?.name === 'AbortError') {
            toastr.info(t`Batch processing was cancelled. Finished items are still available and can be undone separately.`);
        } else {
            console.error(`[${MODULE_ID}] Batch processing failed`, error);
            toastr.error(t`Batch processing stopped. Finished items are safe, and unfinished originals were not changed.`);
        }
        updatePendingReplacementUi();
        progressCanClose = true;
        await progressPopup.complete(POPUP_RESULT.CANCELLED);
    } finally {
        activeAbortController = null;
        await popupPromise;
    }
}

async function refreshCompletedBatch(completed) {
    await getBackgrounds();
    restorePendingOutputTiles();
    selectUploadedBackground(completed.at(-1).outputFilename);
    updatePendingReplacementUi();
}

function restorePendingOutputTiles() {
    for (const replacement of pendingReplacements.values()) {
        insertTemporaryGalleryTile(replacement.outputFilename, replacement.originalFilename);
    }
}

function isPendingFilename(filename) {
    if (pendingReplacements.has(filename)) return true;
    return Array.from(pendingReplacements.values()).some(
        replacement => replacement.originalFilename === filename,
    );
}

function isCurrentDeviceMobile() {
    return isMobilePlatform({
        userAgent: navigator.userAgent,
        userAgentDataMobile: navigator.userAgentData?.mobile,
        platform: navigator.platform,
        maxTouchPoints: navigator.maxTouchPoints,
    });
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
    appendInfo(info, t`Planned output`, `${target.width} × ${target.height} WebP`);

    const safety = document.createElement('div');
    safety.className = 'smart-backgrounds-safety';
    safety.innerHTML = `
        <i class="fa-solid fa-shield-heart"></i>
        <span>${escapeHtml(t`After processing, compare both images and choose whether to replace the original.`)}</span>
    `;

    let strengthInput = null;
    if (plan.mode === 'ai') {
        const control = buildStrengthControl();
        strengthInput = control.input;
        details.append(title, badge, info, control.root, safety);
    } else {
        details.append(title, badge, info, safety);
    }
    content.append(preview, details);
    return { content, strengthInput };
}

function buildStrengthControl() {
    const root = document.createElement('label');
    root.className = 'smart-backgrounds-strength';
    root.title = t`Lower strength preserves original lines and text; higher strength lets the model redraw more detail.`;

    const heading = document.createElement('span');
    heading.textContent = t`Detail strength`;
    const value = document.createElement('output');
    value.textContent = `${Math.round(DEFAULT_SETTINGS.aiStrength * 100)}%`;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '20';
    input.max = '100';
    input.step = '5';
    input.value = String(DEFAULT_SETTINGS.aiStrength * 100);
    input.setAttribute('aria-label', t`Detail strength`);
    input.addEventListener('input', () => {
        value.textContent = `${input.value}%`;
    });

    root.append(heading, value, input);
    return { root, input };
}

function appendInfo(list, label, value) {
    const term = document.createElement('dt');
    term.textContent = label;
    const description = document.createElement('dd');
    description.textContent = value;
    list.append(term, description);
}

function planTitle(plan) {
    if (plan.mode === 'ai') return t`Illustration detail restoration ×4`;
    if (plan.mode === 'downscale') return t`High-resolution performance optimization`;
    return t`Loss-conscious compression`;
}

function planIcon(mode) {
    if (mode === 'ai') return 'fa-solid fa-sparkles';
    if (mode === 'downscale') return 'fa-solid fa-gauge-high';
    return 'fa-solid fa-box-archive';
}

async function processBackground(analysis, plan, aiStrength) {
    activeAbortController = new AbortController();
    let progressCanClose = false;
    let uploadedName = '';
    let outputObjectUrl = '';
    const progress = buildProgressView(analysis.filename, plan);
    const progressPopup = new Popup(progress.root, POPUP_TYPE.DISPLAY, '', {
        large: false,
        allowEscapeClose: false,
        onClosing: () => progressCanClose || !activeAbortController,
    });
    progressPopup.dlg.classList.add('smart-backgrounds-progress-popup');
    progress.cancel.addEventListener('click', () => {
        if (!activeAbortController || activeAbortController.signal.aborted) return;
        progress.cancel.disabled = true;
        progress.cancel.querySelector('span').textContent = t`Cancelling…`;
        activeAbortController.abort();
    });

    const popupPromise = progressPopup.show();
    try {
        updateProgress(progress, t`Preparing image…`, 0.03);
        const { blob: outputBlob, target } = await createOptimizedBackground(
            analysis,
            plan,
            activeAbortController.signal,
            aiStrength,
            (label, value) => updateProgress(progress, label, value),
        );

        throwIfAborted(activeAbortController.signal);
        outputObjectUrl = URL.createObjectURL(outputBlob);
        progress.cancel.disabled = true;
        updateProgress(progress, t`Processing finished. Review the result.`, 1);
        const outputName = await showReplacementConfirmation(
            analysis,
            outputBlob,
            outputObjectUrl,
            target,
            plan,
        );

        if (!outputName) {
            toastr.info(t`The processed result was discarded. The original was not changed.`);
            progressCanClose = true;
            await progressPopup.complete(POPUP_RESULT.CANCELLED);
            return;
        }

        throwIfAborted(activeAbortController.signal);
        updateProgress(progress, t`Adding the new background to SillyTavern…`, 0.97);
        uploadedName = await uploadBackground(outputBlob, outputName);

        const selected = await refreshAndSelectUploadedBackground(uploadedName, analysis.filename);
        if (!selected) {
            throw new Error('The uploaded background could not be selected.');
        }

        pendingReplacements.set(uploadedName, {
            originalFilename: analysis.filename,
            outputFilename: uploadedName,
        });
        updatePendingReplacementUi();
        updateProgress(progress, t`Finished`, 1);
        toastr.success(t`The new background is active. Use its Undo button to restore the original, or close Backgrounds to confirm.`);
        progressCanClose = true;
        await progressPopup.complete(POPUP_RESULT.AFFIRMATIVE);
    } catch (error) {
        if (uploadedName && !pendingReplacements.has(uploadedName)) {
            try {
                await deleteBackgroundFile(uploadedName);
            } catch (cleanupError) {
                console.warn(`[${MODULE_ID}] Failed to clean up an incomplete upload.`, cleanupError);
            }
        }
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
        if (outputObjectUrl) URL.revokeObjectURL(outputObjectUrl);
        activeAbortController = null;
        await popupPromise;
    }
}

async function createOptimizedBackground(analysis, plan, signal, aiStrength, onProgress) {
    onProgress(t`Preparing image…`, 0.03);
    let sourceImage = await loadImage(analysis.objectUrl);

    if (plan.mode === 'ai') {
        sourceImage = await upscaleLocally(
            sourceImage,
            signal,
            value => onProgress(t`Restoring details…`, 0.08 + value * 0.72),
            aiStrength,
        );
    }

    throwIfAborted(signal);
    onProgress(t`Creating the optimized background…`, 0.84);
    const target = fitWithinLongEdge(
        sourceImage.naturalWidth || sourceImage.width,
        sourceImage.naturalHeight || sourceImage.height,
        plan.targetLongEdge,
    );
    const blob = await renderWebp(sourceImage, target, DEFAULT_SETTINGS.webpQuality);
    return { blob, target };
}

function buildProgressView(filename, planOrTitle) {
    const title = typeof planOrTitle === 'string' ? planOrTitle : planTitle(planOrTitle);
    const root = document.createElement('div');
    root.className = 'smart-backgrounds-progress';
    root.innerHTML = `
        <i class="fa-solid fa-wand-magic-sparkles smart-backgrounds-progress-icon"></i>
        <h3>${escapeHtml(title)}</h3>
        <div class="smart-backgrounds-progress-file">${escapeHtml(filename)}</div>
        <div class="smart-backgrounds-progress-track">
            <div class="smart-backgrounds-progress-bar"></div>
        </div>
        <div class="smart-backgrounds-progress-label">${escapeHtml(t`Preparing image…`)}</div>
    `;
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'menu_button smart-backgrounds-progress-cancel';
    cancel.innerHTML = `<i class="fa-solid fa-ban"></i><span>${escapeHtml(t`Cancel background processing`)}</span>`;
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

async function upscaleLocally(image, signal, onProgress, aiStrength) {
    const result = await restoreIllustration(image, signal, onProgress, aiStrength);
    console.info(`[${MODULE_ID}] Real-ESRGAN detail restoration completed.`);
    return result;
}

async function showReplacementConfirmation(analysis, outputBlob, outputUrl, target, plan) {
    const filenameInputId = 'smart_backgrounds_output_filename';
    const proposedName = makeUniqueWebpFilename(
        makeOutputName(analysis.filename, plan.mode),
        getGalleryBackgroundNames(),
    );
    const content = buildComparisonView(analysis, outputBlob, outputUrl, target);
    let confirmedName = '';

    const popup = new Popup(content, POPUP_TYPE.CONFIRM, '', {
        large: true,
        allowVerticalScrolling: true,
        okButton: t`Use the processed image`,
        cancelButton: t`Keep the original`,
        customInputs: [{
            id: filenameInputId,
            type: 'text',
            label: t`New image name`,
            defaultState: proposedName,
            tooltip: t`The image will be saved as WebP. Characters unsupported by Windows will be replaced automatically.`,
        }],
        onClosing: async closingPopup => {
            if (closingPopup.result !== POPUP_RESULT.AFFIRMATIVE) return true;

            const input = closingPopup.dlg.querySelector(`#${filenameInputId}`);
            const normalizedName = normalizeWebpFilename(
                closingPopup.inputResults?.get(filenameInputId),
            );
            if (input instanceof HTMLInputElement) input.value = normalizedName;

            if (!normalizedName) {
                focusFilenameInput(input);
                toastr.warning(t`Please enter a name for the new image.`);
                return false;
            }
            if (normalizedName.toLocaleLowerCase() === analysis.filename.toLocaleLowerCase()) {
                focusFilenameInput(input);
                toastr.warning(t`The new image must use a different name from the original.`);
                return false;
            }
            if (await backgroundFilenameExists(normalizedName)) {
                focusFilenameInput(input);
                toastr.warning(t`A background with this name already exists. Please choose another name.`);
                return false;
            }

            confirmedName = normalizedName;
            return true;
        },
    });
    popup.dlg.classList.add('smart-backgrounds-comparison-popup');

    const result = await popup.show();
    return result === POPUP_RESULT.AFFIRMATIVE ? confirmedName : '';
}

function buildComparisonView(analysis, outputBlob, outputUrl, target) {
    const content = document.createElement('div');
    content.className = 'smart-backgrounds-comparison';

    const title = document.createElement('h3');
    title.textContent = t`Compare before replacing`;
    const grid = document.createElement('div');
    grid.className = 'smart-backgrounds-comparison-grid';
    grid.append(
        buildComparisonCard(
            t`Original`,
            analysis.objectUrl,
            analysis.filename,
            `${analysis.width} × ${analysis.height} · ${formatBytes(analysis.bytes)}`,
        ),
        buildComparisonCard(
            t`Processed`,
            outputUrl,
            t`Processed preview`,
            `${target.width} × ${target.height} · ${formatBytes(outputBlob.size)}`,
        ),
    );

    content.append(title, grid);
    return content;
}

function buildComparisonCard(label, src, imageTitle, metadata) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'smart-backgrounds-comparison-card';
    card.title = t`Click to enlarge`;
    card.setAttribute('aria-label', `${label}: ${t`Click to enlarge`}`);

    const heading = document.createElement('strong');
    heading.textContent = label;
    const frame = document.createElement('span');
    frame.className = 'smart-backgrounds-comparison-image';
    const image = document.createElement('img');
    image.src = src;
    image.alt = imageTitle;
    const zoom = document.createElement('i');
    zoom.className = 'fa-solid fa-magnifying-glass-plus';
    zoom.setAttribute('aria-hidden', 'true');
    frame.append(image, zoom);
    const details = document.createElement('span');
    details.className = 'smart-backgrounds-comparison-meta';
    details.textContent = metadata;

    card.append(heading, frame, details);
    card.addEventListener('click', () => showImagePreview(src, imageTitle));
    return card;
}

function showImagePreview(src, title) {
    const image = document.createElement('img');
    image.src = src;
    image.alt = title;
    image.className = 'img_enlarged';
    const holder = document.createElement('div');
    holder.className = 'img_enlarged_holder';
    holder.append(image);
    const container = document.createElement('div');
    container.className = 'img_enlarged_container';
    container.append(holder);

    image.addEventListener('click', event => {
        image.classList.toggle('zoomed', !image.classList.contains('zoomed'));
        event.stopPropagation();
    });

    const popup = new Popup(container, POPUP_TYPE.DISPLAY, '', {
        large: true,
        transparent: true,
    });
    popup.dlg.style.width = 'unset';
    popup.dlg.style.height = 'unset';
    popup.dlg.addEventListener('click', () => void popup.completeCancelled());
    void popup.show();
}

function getGalleryBackgroundNames() {
    return Array.from(
        document.querySelectorAll('#bg_menu_content .bg_example[bgfile]'),
        tile => tile.getAttribute('bgfile'),
    ).filter(Boolean);
}

async function backgroundFilenameExists(filename) {
    const wanted = filename.toLocaleLowerCase();
    if (getGalleryBackgroundNames().some(name => name.toLocaleLowerCase() === wanted)) {
        return true;
    }

    try {
        const response = await fetch(`/backgrounds/${encodeURIComponent(filename)}`, {
            method: 'HEAD',
            cache: 'no-store',
        });
        return response.ok;
    } catch {
        return false;
    }
}

function focusFilenameInput(input) {
    if (!(input instanceof HTMLInputElement)) return;
    input.focus();
    input.select();
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
    const uploadedName = await response.text();
    deletedBackgroundsThisSession.delete(uploadedName);
    return uploadedName;
}

async function deleteBackgroundFile(filename) {
    const response = await fetch('/api/backgrounds/delete', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ bg: filename }),
        cache: 'no-cache',
    });
    if (!response.ok) {
        throw new Error(`Delete failed: HTTP ${response.status}`);
    }
    deletedBackgroundsThisSession.add(filename);
    applyPendingGalleryState();
}

async function undoPendingReplacement(outputFilename) {
    const replacement = pendingReplacements.get(outputFilename);
    if (!replacement || replacementActionBusy) return;

    replacementActionBusy = true;
    updatePendingReplacementUi();
    let outputDeleted = false;

    try {
        await deleteBackgroundFile(replacement.outputFilename);
        outputDeleted = true;
        pendingReplacements.delete(replacement.outputFilename);
        updatePendingReplacementUi();

        // The original tile is immediately visible again. Select it before the
        // full gallery refresh so Undo feels instant even on a large library.
        selectUploadedBackground(replacement.originalFilename);
        await getBackgrounds();
        restorePendingOutputTiles();
        if (!selectUploadedBackground(replacement.originalFilename)) {
            throw new Error('The restored background could not be selected.');
        }
        toastr.success(t`Replacement undone. The original background was restored.`);
    } catch (error) {
        console.error(`[${MODULE_ID}] Failed to undo replacement.`, error);
        if (outputDeleted) {
            pendingReplacements.delete(replacement.outputFilename);
            updatePendingReplacementUi();
            toastr.warning(t`The new file was removed and the original is safe, but it could not be selected automatically.`);
        } else {
            pendingReplacements.set(replacement.outputFilename, replacement);
            updatePendingReplacementUi();
            toastr.error(t`Undo failed. The original background is still safely kept.`);
        }
    } finally {
        replacementActionBusy = false;
        updatePendingReplacementUi();
    }
}

async function commitPendingReplacements() {
    if (!pendingReplacements.size || replacementActionBusy) return;

    const replacements = Array.from(pendingReplacements.values());
    replacementActionBusy = true;
    updatePendingReplacementUi();
    const confirmed = [];
    let failed = 0;

    try {
        for (const replacement of replacements) {
            try {
                await deleteBackgroundFile(replacement.originalFilename);
                pendingReplacements.delete(replacement.outputFilename);
                confirmed.push(replacement);
            } catch (error) {
                failed += 1;
                console.error(`[${MODULE_ID}] Failed to confirm replacement: ${replacement.originalFilename}`, error);
            }
        }
        await getBackgrounds();
        restorePendingOutputTiles();
        for (const replacement of confirmed) {
            insertTemporaryGalleryTile(replacement.outputFilename, replacement.originalFilename);
        }
        if (confirmed.length) {
            selectUploadedBackground(confirmed.at(-1).outputFilename);
            toastr.success(t`Replacement confirmed. The original background was deleted.`);
        }
        if (failed) {
            toastr.error(t`Some originals could not be deleted, so those replacements remain undoable.`);
        }
    } catch (error) {
        console.error(`[${MODULE_ID}] Failed to refresh confirmed replacements.`, error);
        toastr.warning(t`The replacements were confirmed, but the background list could not refresh automatically.`);
    } finally {
        replacementActionBusy = false;
        updatePendingReplacementUi();
    }
}

function observeBackgroundDrawer() {
    const drawer = document.getElementById('Backgrounds');
    if (!drawer || drawerObserver) return;

    backgroundDrawerWasOpen = drawer.classList.contains('openDrawer');
    drawerObserver = new MutationObserver(() => {
        const isOpen = drawer.classList.contains('openDrawer');
        const shouldCommit = shouldCommitReplacement(
            backgroundDrawerWasOpen,
            isOpen,
            pendingReplacements.size > 0,
            replacementActionBusy,
        );
        backgroundDrawerWasOpen = isOpen;
        if (shouldCommit) {
            void commitPendingReplacements();
        }
    });
    drawerObserver.observe(drawer, { attributes: true, attributeFilter: ['class'] });
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
    restorePendingOutputTiles();
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
            restorePendingOutputTiles();
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
    tile.classList.remove(
        'selected-background',
        'locked-background',
        'mobile-menu-open',
        'smart-backgrounds-pending-original',
        'smart-backgrounds-pending-output',
    );
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
    addPendingReplacementBanner();
    observeGallery();
    observeBackgroundDrawer();
    document.addEventListener('click', onDocumentClick, true);
    console.info(`[${MODULE_ID}] Smart Backgrounds initialized for SillyTavern 1.18.0+.`);
}
