import { eyeCentersFromLandmarks } from './geometry.js';

const VERSION = '0.10.14';
export const BUNDLE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/vision_bundle.mjs`;
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`;
const HAIR_MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/hair_segmenter/float32/latest/hair_segmenter.tflite';
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task';

let cached = null;

async function withFallback(create) {
  try {
    return await create('GPU');
  } catch (e) {
    console.warn('GPU delegate failed, falling back to CPU', e);
    return create('CPU');
  }
}

async function build(onProgress) {
  onProgress?.('画像認識の準備をしています…（初回は少し時間がかかります）');
  const { FilesetResolver, ImageSegmenter, FaceLandmarker } = await import(BUNDLE_URL);
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL);

  onProgress?.('髪の認識モデルを読み込んでいます…');
  const segmenter = await withFallback((delegate) => ImageSegmenter.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: HAIR_MODEL, delegate },
    runningMode: 'IMAGE',
    outputConfidenceMasks: true,
    outputCategoryMask: false,
  }));

  onProgress?.('顔の認識モデルを読み込んでいます…');
  const landmarker = await withFallback((delegate) => FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: FACE_MODEL, delegate },
    runningMode: 'IMAGE',
    numFaces: 3,
  }));

  return {
    /** canvas -> Mask of hair confidence */
    segmentHair(canvas) {
      const result = segmenter.segment(canvas);
      try {
        const masks = result.confidenceMasks;
        const m = masks[masks.length > 1 ? 1 : 0];
        return { width: m.width, height: m.height, data: new Float32Array(m.getAsFloat32Array()) };
      } finally {
        result.close();
      }
    },
    /** canvas -> Array<{ left, right, box }> in pixels */
    detectFaces(canvas) {
      const { width, height } = canvas;
      const result = landmarker.detect(canvas);
      return (result.faceLandmarks || []).map((lm) => {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of lm) {
          minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
        }
        return { ...eyeCentersFromLandmarks(lm, width, height), box: { width: (maxX - minX) * width, height: (maxY - minY) * height } };
      });
    },
  };
}

export function initVision(onProgress) {
  if (!cached) cached = build(onProgress).catch((e) => { cached = null; throw e; });
  return cached;
}
