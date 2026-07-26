# SillyTavern Smart Backgrounds

Smart Backgrounds adds real local AI detail restoration and performance-friendly background optimization to SillyTavern.

It solves two opposite problems:

- Small but beautiful illustrations can have blurred edges and missing-looking details reconstructed locally with Real-ESRGAN.
- Extremely large images can be resized to a screen-appropriate 4K-class copy so switching backgrounds uses much less memory.

The original image is never overwritten. Every result is added as a separate WebP background.

## Features

- One-click action inside SillyTavern's existing Backgrounds drawer.
- Automatic choice between local AI detail restoration, downscaling, and high-quality compression.
- Bundled `RealESRGAN_x4plus_anime_6B` restoration model. No Ollama installation, separate AI server, or cloud upload is required.
- GPU acceleration through ONNX Runtime WebGPU, with a WebAssembly CPU fallback.
- Overlapping tile-based processing, visible progress, and cancellation so memory use stays bounded.
- 4096-pixel maximum long edge and high-quality WebP output.
- Simplified Chinese, Traditional Chinese, and English interface.
- Original backgrounds remain untouched.

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
3. Review the detected plan.
4. Click **Start processing**.
5. The optimized copy is added to the background library and selected automatically.

AI restoration is a one-time process. Later background switches load the generated WebP directly.

The bundled model is tuned for anime, illustration, and graphic-art backgrounds. It can reconstruct clean contours and small drawn details that ordinary resizing cannot create. Like every restoration model, it estimates missing detail rather than recovering a mathematically exact original, and it may over-sharpen photographs. The untouched source is always kept so the result is easy to compare or discard.

## Privacy

Image pixels stay in the browser running SillyTavern. Models are included with the extension, so processing can work offline after the extension has been installed.

## Compatibility

- SillyTavern 1.18.0 or newer.
- A current Chromium-based browser with WebGPU is recommended. Other modern browsers can use the slower CPU fallback.
- The extension download is roughly 41 MB because the actual restoration model and its local runtime are included.
- Static image backgrounds are supported. Animated backgrounds are intentionally not processed.

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
- ONNX Runtime Web: MIT.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for model provenance, checksum, and full license pointers.
