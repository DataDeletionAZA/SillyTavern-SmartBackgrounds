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
let galleryObserver = null;
let drawerObserver = null;
let activeAbortController = null;
let pendingReplacement = null;
let replacementActionBusy = false;
let backgroundDrawerWasOpen = false;
const deletedBackgroundsThisSession = new Set();
let initialized = false;

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
            <strong>${escapeHtml(t`Replacement ready`)}</strong>
            <span>${escapeHtml(t`The new background is active. The original will be deleted only after you close Backgrounds.`)}</span>
        </div>
    `;

    const undo = document.createElement('button');
    undo.id = 'smart_backgrounds_undo';
    undo.type = 'button';
    undo.className = 'menu_button menu_button_icon smart-backgrounds-undo';
    undo.title = t`Undo and restore the original`;
    undo.innerHTML = `
        <i class="fa-solid fa-rotate-left"></i>
        <span>${escapeHtml(t`Undo`)}</span>
    `;
    undo.addEventListener('click', () => void undoPendingReplacement());
    banner.appendChild(undo);
    header.insertAdjacentElement('afterend', banner);
}

function updatePendingReplacementUi() {
    const banner = document.getElementById('smart_backgrounds_pending');
    const undo = document.getElementById('smart_backgrounds_undo');
    if (banner) {
        banner.hidden = !pendingReplacement;
        banner.title = pendingReplacement
            ? `${pendingReplacement.originalFilename} → ${pendingReplacement.outputFilename}`
            : '';
    }
    if (undo instanceof HTMLButtonElement) {
        undo.disabled = replacementActionBusy;
    }
    applyPendingGalleryState();
}

function applyPendingGalleryState() {
    const tiles = document.querySelectorAll('#bg_menu_content .bg_example[bgfile]');
    for (const tile of tiles) {
        const filename = tile.getAttribute('bgfile');
        if (filename && deletedBackgroundsThisSession.has(filename)) {
            tile.remove();
            continue;
        }
        tile.classList.toggle(
            'smart-backgrounds-pending-original',
            Boolean(pendingReplacement && filename === pendingReplacement.originalFilename),
        );
        tile.classList.toggle(
            'smart-backgrounds-pending-output',
            Boolean(pendingReplacement && filename === pendingReplacement.outputFilename),
        );
    }
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
    if (pendingReplacement) {
        toastr.warning(t`Please undo the current replacement or close Backgrounds to confirm it before processing another image.`);
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

    details.append(title, badge, info, safety);
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
    if (plan.mode === 'ai') return t`Illustration detail restoration ×4`;
    if (plan.mode === 'downscale') return t`High-resolution performance optimization`;
    return t`Loss-conscious compression`;
}

function planIcon(mode) {
    if (mode === 'ai') return 'fa-solid fa-sparkles';
    if (mode === 'downscale') return 'fa-solid fa-gauge-high';
    return 'fa-solid fa-box-archive';
}

async function processBackground(analysis, plan) {
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
        let sourceImage = await loadImage(analysis.objectUrl);

        if (plan.mode === 'ai') {
            sourceImage = await upscaleLocally(
                sourceImage,
                activeAbortController.signal,
                value => updateProgress(progress, t`Restoring details…`, 0.08 + value * 0.72),
            );
        }

        throwIfAborted(activeAbortController.signal);
        updateProgress(progress, t`Creating the optimized background…`, 0.84);
        const target = fitWithinLongEdge(
            sourceImage.naturalWidth || sourceImage.width,
            sourceImage.naturalHeight || sourceImage.height,
            plan.targetLongEdge,
        );
        const outputBlob = await renderWebp(sourceImage, target, DEFAULT_SETTINGS.webpQuality);

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

        pendingReplacement = {
            originalFilename: analysis.filename,
            outputFilename: uploadedName,
        };
        updatePendingReplacementUi();
        updateProgress(progress, t`Finished`, 1);
        toastr.success(t`The new background is active. Use Undo to restore the original, or close Backgrounds to confirm.`);
        progressCanClose = true;
        await progressPopup.complete(POPUP_RESULT.AFFIRMATIVE);
    } catch (error) {
        if (uploadedName && pendingReplacement?.outputFilename !== uploadedName) {
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

async function upscaleLocally(image, signal, onProgress) {
    const result = await restoreIllustration(image, signal, onProgress);
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

async function undoPendingReplacement() {
    if (!pendingReplacement || replacementActionBusy) return;

    const replacement = pendingReplacement;
    replacementActionBusy = true;
    updatePendingReplacementUi();
    let outputDeleted = false;

    try {
        await deleteBackgroundFile(replacement.outputFilename);
        outputDeleted = true;
        pendingReplacement = null;
        updatePendingReplacementUi();

        // The original tile is immediately visible again. Select it before the
        // full gallery refresh so Undo feels instant even on a large library.
        selectUploadedBackground(replacement.originalFilename);
        await getBackgrounds();
        if (!selectUploadedBackground(replacement.originalFilename)) {
            throw new Error('The restored background could not be selected.');
        }
        toastr.success(t`Replacement undone. The original background was restored.`);
    } catch (error) {
        console.error(`[${MODULE_ID}] Failed to undo replacement.`, error);
        if (outputDeleted) {
            pendingReplacement = null;
            updatePendingReplacementUi();
            toastr.warning(t`The new file was removed and the original is safe, but it could not be selected automatically.`);
        } else {
            pendingReplacement = replacement;
            updatePendingReplacementUi();
            toastr.error(t`Undo failed. The original background is still safely kept.`);
        }
    } finally {
        replacementActionBusy = false;
        updatePendingReplacementUi();
    }
}

async function commitPendingReplacement() {
    if (!pendingReplacement || replacementActionBusy) return;

    const replacement = pendingReplacement;
    replacementActionBusy = true;
    updatePendingReplacementUi();
    let originalDeleted = false;

    try {
        await deleteBackgroundFile(replacement.originalFilename);
        originalDeleted = true;
        pendingReplacement = null;
        updatePendingReplacementUi();
        await getBackgrounds();
        insertTemporaryGalleryTile(replacement.outputFilename, replacement.originalFilename);
        selectUploadedBackground(replacement.outputFilename);
        toastr.success(t`Replacement confirmed. The original background was deleted.`);
    } catch (error) {
        console.error(`[${MODULE_ID}] Failed to confirm replacement.`, error);
        if (originalDeleted) {
            pendingReplacement = null;
            toastr.warning(t`The replacement was confirmed, but the background list could not refresh automatically.`);
        } else {
            pendingReplacement = replacement;
            toastr.error(t`The original could not be deleted, so it is still safely kept. Reopen Backgrounds to try again or undo.`);
        }
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
            Boolean(pendingReplacement),
            replacementActionBusy,
        );
        backgroundDrawerWasOpen = isOpen;
        if (shouldCommit) {
            void commitPendingReplacement();
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
