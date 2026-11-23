# SillyTavern Smart Backgrounds

Smart Backgrounds adds real local AI detail restoration and performance-friendly background optimization to SillyTavern.

It solves two opposite problems:

- Small but beautiful illustrations can have blurred edges and missing-looking details reconstructed locally.
- Extremely large images can be resized to a screen-appropriate 4K-class copy so switching backgrounds uses much less memory.

After processing, a side-by-side window lets you compare the original and processed images, enlarge either image, and rename the result. Each accepted result gets its own **Undo** action while the Backgrounds drawer remains open. You can process more images immediately; closing the drawer confirms all remaining results and deletes their originals.

## Features

- One-click action inside SillyTavern's existing Backgrounds drawer.
- Automatic choice between local AI detail restoration, downscaling, and high-quality compression.
- Four bundled restoration models: Real-ESRGAN Anime 6B ×4, Fallin Soft ×2, Alchemy ×4, and APISR ×2. No Ollama installation, separate AI server, or cloud upload is required.
- Conservative 40% detail strength by default, with a native slider to reduce merged lines and over-redrawn text or raise restoration strength when an image benefits from it.
- GPU acceleration through ONNX Runtime WebGPU, with a WebAssembly CPU fallback.
- Overlapping tile-based processing, visible progress, and cancellation so memory use stays bounded.
- Selectable batch processing with an independent detail-strength slider and review step for every image; processing remains sequential to keep memory use bounded.
- 4096-pixel maximum long edge and high-quality WebP output.
- Simplified Chinese, Traditional Chinese, and English interface.
- Side-by-side, click-to-enlarge comparison before anything is replaced.
- Editable, Windows-safe output filenames with conflict protection.
- Transactional replacement: the original stays recoverable until the Backgrounds drawer is closed.
- Per-image Undo deletes only that unsatisfactory result and restores only its original.
- Phone and tablet guard: processed backgrounds remain usable, but memory-heavy image processing cannot be started on mobile.

## Install

In SillyTavern:

1. Open **Extensions**.
2. Choose **Install Extension**.
3. Paste:

   `https://github.com/DataDeletionAZA/SillyTavern-SmartBackgrounds`

4. Reload SillyTavern after installation.

## Use

1. Open SillyTavern's **Backgrounds** drawer.
2. Click the sparkle-wand action on a background, or select a background and click **Smart Optimize** at the top.
3. Review the detected plan. For small images, choose a **Restoration model** and adjust **Detail strength** if desired.
4. Click **Start processing**.
5. Compare the two images. Click either preview to enlarge it, edit the new filename, or select another model and retry the original.
6. Choose **Use the processed image** to replace the gallery entry, or **Keep the original** to discard the temporary result.
7. Continue processing other images without closing the drawer. If one result is poor, use the Undo action on that processed image; other pending replacements are unaffected.
8. When the remaining results are good, close the Backgrounds drawer. That confirms them and deletes their old files.

For batch work, choose **Batch Optimize**, select the starting model for the batch, and set each selected image's detail strength independently. The extension processes them one at a time and pauses after each image for side-by-side comparison, enlargement, filename editing, and optional model retry on each restored image. Accepted results remain independently undoable until the drawer closes.

AI restoration is a one-time process. Later background switches load the generated WebP directly.

The restoration models are intended for illustration backgrounds. At lower detail strengths, the result retains more of the conventionally upscaled source image. Models estimate missing detail, so the same image can look noticeably different depending on the model and strength.

If processing is cancelled or fails, the original is not changed. If SillyTavern is reloaded before the drawer is closed, the extension chooses safety: it does not delete the original automatically.

## Privacy

Image pixels stay in the browser running SillyTavern. Models are included with the extension, so processing can work offline after the extension has been installed.

## Compatibility

- SillyTavern 1.18.0 or newer.
- macOS, Windows, and Linux hosts. Output names are normalized for Windows restrictions and checked case-insensitively before upload.
- A current Chromium-based browser with WebGPU is recommended. Other modern browsers can use the slower CPU fallback.
- The four model files and local runtime occupy about 91 MiB of installed disk space.
- Static image backgrounds are supported. Animated backgrounds are intentionally not processed.

### Phones and tablets

The extension can be visible on a phone, and backgrounds already processed on a computer work normally there. Image processing itself is disabled on phones and tablets because the model, its runtime, and the enlarged output canvas can exceed a mobile browser's memory limit.

The browser loads a model only when it is used for desktop detail restoration, with one model active at a time. Opening SillyTavern on a phone does not fetch models into that browser. The model files occupy disk space on the device hosting SillyTavern, even if that device is a phone.

## Development

```sh
npm install
npm test
npm run build
```

The generated `dist/` bundle plus the `models/` and `runtime/` directories are committed so end users do not need Node.js or npm.

## Licenses

- This extension: MIT.
- Real-ESRGAN model and architecture: BSD-3-Clause.
- Fallin Soft and Alchemy weights: CC BY 4.0.
- APISR ONNX weights: GPL-3.0.
- ONNX Runtime Web: MIT.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for model provenance, checksum, and full license pointers.
