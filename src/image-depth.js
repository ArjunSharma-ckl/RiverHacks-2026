const modelId = 'onnx-community/depth-anything-v2-small';
const revision = '4472b7362082ad9968fee890ca0f1e5aca36b93d';
const gridSize = 65;
let modelPromise;

async function loadModel(onProgress) {
  const { AutoModelForDepthEstimation, AutoProcessor, RawImage } = await import('@huggingface/transformers');
  let previousPercent = -1;
  const [processor, model] = await Promise.all([
    AutoProcessor.from_pretrained(modelId, { revision }),
    AutoModelForDepthEstimation.from_pretrained(modelId, {
      revision, dtype: 'q8',
      progress_callback(event) {
        if (event.status !== 'progress' || !event.file?.endsWith('.onnx')) return;
        const percent = Math.round(event.progress);
        if (Number.isFinite(percent) && percent !== previousPercent) {
          previousPercent = percent;
          onProgress(`Downloading depth model: ${percent}%`);
        }
      },
    }),
  ]);
  return { processor, model, RawImage };
}

function hasVisibleContrast(image) {
  const pixels = image.data;
  const origin = (Math.floor(image.height / 2) * image.width + Math.floor(image.width / 2)) * image.channels;
  for (let y = 2; y < image.height; y += 8) {
    for (let x = 2; x < image.width; x += 8) {
      const start = (y * image.width + x) * image.channels;
      if (
        Math.abs(pixels[start] - pixels[origin]) > 8 ||
        Math.abs(pixels[start + 1] - pixels[origin + 1]) > 8 ||
        Math.abs(pixels[start + 2] - pixels[origin + 2]) > 8
      ) return true;
    }
  }
  return false;
}

function downsample(depth) {
  const [height, width] = depth.dims.slice(-2);
  const values = new Float32Array(gridSize * gridSize);
  if (width < gridSize || height < gridSize || depth.data.length !== height * width) {
    throw new Error('The model returned an unexpected depth grid.');
  }
  for (let row = 0; row < gridSize; row++) {
    const top = Math.floor(row * height / gridSize);
    const bottom = Math.floor((row + 1) * height / gridSize);
    for (let col = 0; col < gridSize; col++) {
      const left = Math.floor(col * width / gridSize);
      const right = Math.floor((col + 1) * width / gridSize);
      let sum = 0;
      for (let y = top; y < bottom; y++) {
        for (let x = left; x < right; x++) sum += depth.data[y * width + x];
      }
      const value = sum / ((bottom - top) * (right - left));
      if (!Number.isFinite(value)) throw new Error('The model returned invalid depth values.');
      values[row * gridSize + col] = value;
    }
  }
  if (Math.max(...values) - Math.min(...values) < 1e-5) throw new ReliefInputError('The image produced no usable relief.');
  return values;
}

export class ReliefInputError extends Error {}

/**
 * Produces a unitless relative inverse-depth grid for the center square.
 * Higher values represent nearer surfaces. Treat these as estimated relative
 * relief only for a near-nadir view without sky, large objects, or overlays.
 */
export async function estimateImageRelief(source, onProgress = () => {}) {
  onProgress('Loading the image depth model…');
  modelPromise ??= loadModel(onProgress).catch(error => {
    modelPromise = undefined;
    throw error;
  });
  const { processor, model, RawImage } = await modelPromise;
  const image = await RawImage.read(source);
  const side = Math.min(image.width, image.height);
  if (side < gridSize) throw new ReliefInputError(`Use an image at least ${gridSize} × ${gridSize} pixels.`);
  const square = (await image.center_crop(side, side)).rgb();
  if (!hasVisibleContrast(square)) throw new ReliefInputError('The image has too little visible detail to estimate terrain.');
  onProgress('Estimating relative terrain depth from the center of the image…');
  const { predicted_depth } = await model(await processor(square));
  return { size: gridSize, values: downsample(predicted_depth) };
}
