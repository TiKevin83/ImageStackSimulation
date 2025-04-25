import fs from 'fs';
import path from 'path';
import { createCanvas, loadImage, ImageData } from 'canvas';
import { getScore } from '@nrs-binding/ssimulacra2';

const INPUT_DIR = './output';
const OUTPUT_DIR = './reconstructions';
const NUM_IMAGES = 32;
const WIDTH = 256;
const HEIGHT = 256;
const HIGH_RES_FACTOR = 4;

function generateBayerMatrix(): Uint8ClampedArray {
    const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);

    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            const i = (y * WIDTH + x) * 4;

            // RGGB pattern
            const isEvenRow = y % 2 === 0;
            const isEvenCol = x % 2 === 0;

            data[i + 0] = isEvenRow && isEvenCol ? 255 : 0;          // Red
            data[i + 1] = (!isEvenRow && isEvenCol) || (isEvenRow && !isEvenCol) ? 255 : 0; // Green
            data[i + 2] = !isEvenRow && !isEvenCol ? 255 : 0;        // Blue
            data[i + 3] = 255;                                       // Alpha
        }
    }

    return data;
}
  
async function saveBayerMatrix() {
    const pixelData = generateBayerMatrix();
    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext('2d');
    const imageData = new ImageData(pixelData, WIDTH, HEIGHT);
    ctx.putImageData(imageData, 0, 0);

    const out = fs.createWriteStream(path.join(OUTPUT_DIR, 'bayerMatrix.png'));
    const stream = canvas.createPNGStream();
    stream.pipe(out);
    await new Promise((resolve) => out.on('finish', resolve));
    console.log('✅ Bayer matrix saved to bayerMatrix.png');
}

async function reconstructImage() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

  const transforms = JSON.parse(fs.readFileSync(path.join(INPUT_DIR, 'transforms.json'), 'utf8')) as { dx: number; dy: number; rotation: number }[];

  const highResWidth = WIDTH * HIGH_RES_FACTOR;
  const highResHeight = HEIGHT * HIGH_RES_FACTOR;

  const accumulator = new Float32Array(highResWidth * highResHeight * 4);
  const patternAccumulator = new Float32Array(highResWidth * highResHeight * 4);

  await saveBayerMatrix(); // Save the Bayer matrix for reference

  const bayerMaskFilePath = path.join(OUTPUT_DIR, 'bayerMatrix.png');
  const bayerMask = await loadImage(bayerMaskFilePath);

  for (let i = 0; i < NUM_IMAGES; i++) {
    const filePath = path.join(INPUT_DIR, `bayered_${i + 1}.png`);
    const img = await loadImage(filePath);

    const canvas = createCanvas(highResWidth, highResHeight);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    const patternCanvas = createCanvas(highResWidth, highResHeight);
    const patternCtx = patternCanvas.getContext('2d');
    patternCtx.imageSmoothingEnabled = false;

    const transform = transforms[i];
    //const angleRad = -transform.rotation * (Math.PI / 180); // inverse rotation

    ctx.translate((highResWidth / 2) - transform.dx, (highResHeight / 2) - transform.dy);
    //ctx.rotate(angleRad);
    ctx.drawImage(img, -highResWidth / 2, -highResHeight / 2, highResWidth, highResHeight);

    const imageData = ctx.getImageData(0, 0, highResWidth, highResHeight);
    const data = imageData.data;

    patternCtx.translate((highResWidth / 2) - transform.dx, (highResHeight / 2) - transform.dy);
    //ctx.rotate(angleRad);
    patternCtx.drawImage(bayerMask, -highResWidth / 2, -highResHeight / 2, highResWidth, highResHeight);

    const patternImageData = patternCtx.getImageData(0, 0, highResWidth, highResHeight);
    const patternData = patternImageData.data;

    for (let j = 0; j < data.length; j++) {
      accumulator[j] += data[j];
      patternAccumulator[j] += patternData[j];
    }

    // Export result
    const out = fs.createWriteStream(path.join(OUTPUT_DIR, `reconstructed_${i + 1}.png`));
    const stream = canvas.createPNGStream();
    stream.pipe(out);
    await new Promise((resolve) => out.on('finish', resolve));
  }

  const stack = new Uint8ClampedArray(accumulator.length);
  for (let i = 0; i < accumulator.length; i += 4) {
    stack[i] = Math.min(255, accumulator[i] / NUM_IMAGES);       // Red
    stack[i + 1] = Math.min(255, accumulator[i + 1] / NUM_IMAGES); // Green (adjusted!)
    stack[i + 2] = Math.min(255, accumulator[i + 2] / NUM_IMAGES);     // Blue
    stack[i + 3] = 255;
  }

  const patternStack = new Uint8ClampedArray(patternAccumulator.length);
  let averagePattern = 0;
  let sampleCount = 0
  for (let i = 0; i < patternAccumulator.length; i += 4) {
    patternStack[i] = Math.min(255, patternAccumulator[i] / NUM_IMAGES);       // Red
    patternStack[i + 1] = Math.min(255, patternAccumulator[i + 1] / NUM_IMAGES); // Green (no need to adjust because of subpixel normalization)
    patternStack[i + 2] = Math.min(255, patternAccumulator[i + 2] / NUM_IMAGES);     // Blue
    patternStack[i + 3] = 255;
    averagePattern += patternStack[i];
    averagePattern += patternStack[i + 1];
    averagePattern += patternStack[i + 2];
    sampleCount += 3;
  }

  averagePattern /= sampleCount;

  const displayPattern = new Uint8ClampedArray(patternAccumulator.length);
  for (let i = 0; i < patternAccumulator.length; i += 4) {
    displayPattern[i] = Math.min(255, patternStack[i] / averagePattern * 85);       // Red
    displayPattern[i + 1] = Math.min(255, patternStack[i + 1] / averagePattern * 85); // Green (no need to adjust because of subpixel normalization)
    displayPattern[i + 2] = Math.min(255, patternStack[i + 2] / averagePattern * 85);     // Blue
    displayPattern[i + 3] = 255;
  }

  const displayPatternCanvas = createCanvas(highResWidth, highResHeight);
  const displayPatternCtx = displayPatternCanvas.getContext('2d');
  const displayPatternImageData = displayPatternCtx.createImageData(highResWidth, highResHeight);
  displayPatternImageData.data.set(displayPattern);
  displayPatternCtx.putImageData(displayPatternImageData, 0, 0);

  const patternOut = fs.createWriteStream('patternVisualization.png');
  const patternStream = displayPatternCanvas.createPNGStream();
  patternStream.pipe(patternOut);
  await new Promise((resolve) => patternOut.on('finish', resolve));

  console.log('✅ Visualization of Subtracted Moire pattern saved as "patternVisualization.png"');

  for (let i = 0; i < accumulator.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const patternValue = patternAccumulator[i + c];
      if (patternValue > 0) {
        stack[i + c] = Math.min(255, accumulator[i + c] / (patternValue / averagePattern / 3));
      } else {
        stack[i + c] = 0;
      }
    }
    stack[i + 3] = 255;
  }

  const highResCanvas = createCanvas(highResWidth, highResHeight);
  const highResCtx = highResCanvas.getContext('2d');
  const highResImageData = highResCtx.createImageData(highResWidth, highResHeight);
  highResImageData.data.set(stack);
  highResCtx.putImageData(highResImageData, 0, 0);

  const out = fs.createWriteStream('reconstruct_improved.png');
  const stream = highResCanvas.createPNGStream();
  stream.pipe(out);
  await new Promise((resolve) => out.on('finish', resolve));

  console.log('✅ Reconstructed image saved as "reconstruct_improved.png"');

  getScore('./M81-M82-1024.png', './reconstruct_improved.png').then(score => {
    console.log('ssimulacra2 score:', score);
  });
}

reconstructImage().catch(console.error);
