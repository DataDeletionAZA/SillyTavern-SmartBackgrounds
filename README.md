# SillyTavern Smart Backgrounds

Smart Backgrounds adds local AI upscaling and performance-friendly background optimization to SillyTavern.

It solves two opposite problems:

- Small but beautiful images can be enhanced locally with a compact ESRGAN model.
- Extremely large images can be resized to a screen-appropriate 4K-class copy so switching backgrounds uses much less memory.

The original image is never overwritten. Every result is added as a separate WebP background.

## Features

- One-click action inside SillyTavern's existing Backgrounds drawer.
- Automatic choice between local AI enhancement, downscaling, and high-quality compression.
- Bundled 2x, 3x, and 4x ESRGAN Slim models. No image is uploaded to an external AI service.
- GPU acceleration through TensorFlow.js WebGL, with a CPU fallback.
- Tile-based processing, visible progress, and cancellation.
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

AI enhancement is a one-time process. Later background switches load the generated WebP directly.

## Privacy

Image pixels stay in the browser running SillyTavern. Models are included with the extension, so processing can work offline after the extension has been installed.

## Compatibility

- SillyTavern 1.18.0 or newer.
- A modern browser with WebGL is recommended.
- Static image backgrounds are supported. Animated backgrounds are intentionally not processed.

## Development

```sh
npm install
npm test
npm run build
```

The generated `dist/` bundle and `models/` directory are committed so end users do not need Node.js or npm.

## Licenses

- This extension: MIT.
- UpscalerJS and ESRGAN Slim packages: MIT.
- TensorFlow.js: Apache-2.0.
