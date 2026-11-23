# Third-party notices

## Real-ESRGAN illustration restoration model

- Architecture and original weights: [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN)
- Model: `RealESRGAN_x4plus_anime_6B`
- ONNX conversion source: [deepghs/imgutils-models](https://huggingface.co/deepghs/imgutils-models/blob/main/real_esrgan/RealESRGAN_x4plus_anime_6B.onnx)
- Bundled model SHA-256: `2648cab4c4343541c1aa291c6754e9e8edbe7a813fffc2a677423dd12cb6b7f7`
- License: BSD-3-Clause; see `third_party/Real-ESRGAN-LICENSE.txt`.

## Fallin Soft ×2 and Alchemy ×4

- Author and source: renarchi, [Fallin Soft](https://github.com/renarchi/Re-SISR/releases/tag/Fallin) and [Alchemy](https://github.com/renarchi/Re-SISR/releases/tag/4x_Alchemy).
- License: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) under [renarchi's legacy model terms](https://github.com/renarchi/Re-SISR/blob/main/LICENSE.md).
- `Fallin_Soft_x2.onnx` uses the author's FP32 ONNX file. SHA-256: `487792c65406a6851a6bd48d5cbdcee75317fdc3e241f02fe7054936b9914d15`.
- `Alchemy_x4.onnx` is a conversion of the author's weights to ONNX with variable image dimensions. SHA-256: `8f4a45a37357d9e2f2ae698b0703798f3f15260ba71810f6d7a57ff2fada6c6a`.

## APISR ×2

- Source: [APISR, Wang et al.](https://github.com/Kiteretsu77/APISR/tree/fabe8332413bc7f4024e6db39141c68692e88ea5) and the [original 2× RRDB checkpoint](https://github.com/Kiteretsu77/APISR/releases/download/v0.1.0/2x_APISR_RRDB_GAN_generator.pth).
- `APISR_RRDB_x2.onnx` uses [Xenova's FP32 ONNX conversion](https://huggingface.co/Xenova/2x_APISR_RRDB_GAN_generator-onnx/blob/6361f81701564a71fe9aed63b1f1a150e0340e8f/onnx/model.onnx). SHA-256: `c0c1bd343db0da03de28c5eb82c1cadfd5c77f909c9351fffda047dd116a3a24`.
- License: GPL-3.0; see `third_party/APISR-LICENSE.txt`.

## ONNX Runtime Web

- Project: [Microsoft ONNX Runtime](https://github.com/microsoft/onnxruntime)
- Package: `onnxruntime-web`
- License: MIT; see `third_party/ONNX-Runtime-LICENSE.txt`.
