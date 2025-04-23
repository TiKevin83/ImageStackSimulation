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

function generateDrizzleGrid(): Uint8ClampedArray {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * HIGH_RES_FACTOR * HIGH_RES_FACTOR * 4);

  for (let y = 0; y < HEIGHT * HIGH_RES_FACTOR; y++) {
    for (let x = 0; x < WIDTH * HIGH_RES_FACTOR; x++) {
      const keepY = y % 4 === 0 || y % 4 === 1;
      const keepX = x % 4 === 0 || x % 4 === 1;
      const i = (y * WIDTH * HIGH_RES_FACTOR + x) * 4;
      for (let c = 0; c < 3; c++) {
        if (!keepX || !keepY) {
          data[i + c] = 0;
          continue;
        }
        data[i + c] = 255;
      }
      data[i + 3] = 255;
    }
  }

  return data;
}

async function saveDrizzleGrid() {
    const pixelData = generateDrizzleGrid();
    const canvas = createCanvas(WIDTH * HIGH_RES_FACTOR, HEIGHT * HIGH_RES_FACTOR);
    const ctx = canvas.getContext('2d');
    const imageData = new ImageData(pixelData, WIDTH * HIGH_RES_FACTOR, HEIGHT * HIGH_RES_FACTOR);
    ctx.putImageData(imageData, 0, 0);

    const out = fs.createWriteStream(path.join(OUTPUT_DIR, 'drizzleGrid.png'));
    const stream = canvas.createPNGStream();
    stream.pipe(out);
    await new Promise((resolve) => out.on('finish', resolve));
    console.log('✅ Drizzle Grid saved to drizzleGrid.png');
}

async function reconstructImage() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

  const transforms = JSON.parse(fs.readFileSync(path.join(INPUT_DIR, 'transforms.json'), 'utf8')) as { dx: number; dy: number; rotation: number }[];

  const highResWidth = WIDTH * HIGH_RES_FACTOR;
  const highResHeight = HEIGHT * HIGH_RES_FACTOR;

  const accumulator = new Float32Array(highResWidth * highResHeight * 4);
  const patternAccumulator = new Float32Array(highResWidth * highResHeight * 4);
  
  await saveDrizzleGrid(); // Save the Bayer matrix for reference

  const drizzleGridFilePath = path.join(OUTPUT_DIR, 'drizzleGrid.png');
  const drizzleGrid = await loadImage(drizzleGridFilePath);

  for (let i = 0; i < NUM_IMAGES; i++) {
    const filePath = path.join(INPUT_DIR, `unbayered_${i + 1}.png`);
    const img = await loadImage(filePath);

    const canvas = createCanvas(highResWidth, highResHeight);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    const patternCanvas = createCanvas(highResWidth, highResHeight);
    const patternCtx = patternCanvas.getContext('2d');
    patternCtx.imageSmoothingEnabled = false;

    ctx.drawImage(img, 0, 0, highResWidth, highResHeight);

    const inputData = ctx.getImageData(0, 0, highResWidth , highResHeight);
    const inputPixels = inputData.data;

    const drizzleCanvas = createCanvas(highResWidth, highResHeight);
    const drizzleCtx = drizzleCanvas.getContext('2d');
    drizzleCtx.imageSmoothingEnabled = false;
    const outputData = drizzleCtx.createImageData(highResWidth, highResHeight);
    const outputPixels = outputData.data;

    for (let y = 0; y < highResHeight; y++) {
      for (let x = 0; x < highResWidth; x++) {
        const keepY = y % 4 === 0 || y % 4 === 1;
        const keepX = x % 4 === 0 || x % 4 === 1;
        if (!keepX || !keepY) {
          const i = (y * highResWidth + x) * 4;
          for (let c = 0; c < 4; c++) {
            if (c === 3) {
              outputPixels[i + c] = 255;
            }
          }
          continue;
        };
  
        const i = (y * highResWidth + x) * 4;
        for (let c = 0; c < 4; c++) {
          outputPixels[i + c] = inputPixels[i + c];
        }
      }
    }

    const tempCanvas = createCanvas(highResWidth, highResHeight);
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.imageSmoothingEnabled = false;
    tempCtx.putImageData(outputData, 0, 0);

    const transform = transforms[i];
    //const angleRad = -transform.rotation * (Math.PI / 180); // inverse rotation

    drizzleCtx.translate((highResWidth / 2) - transform.dx, (highResHeight / 2) - transform.dy);
    //ctx.rotate(angleRad);
    drizzleCtx.drawImage(tempCanvas, -highResWidth / 2, -highResHeight / 2, highResWidth, highResHeight);

    const imageData = drizzleCtx.getImageData(0, 0, highResWidth, highResHeight);
    const data = imageData.data;

    patternCtx.translate((highResWidth / 2) - transform.dx, (highResHeight / 2) - transform.dy);
    //ctx.rotate(angleRad);
    patternCtx.drawImage(drizzleGrid, -highResWidth / 2, -highResHeight / 2, highResWidth, highResHeight);

    const patternImageData = patternCtx.getImageData(0, 0, highResWidth, highResHeight);
    const patternData = patternImageData.data;

    for (let j = 0; j < data.length; j++) {
      accumulator[j] += data[j];
      patternAccumulator[j] += patternData[j];
    }

    // Export result
    const out = fs.createWriteStream(path.join(OUTPUT_DIR, `reconstructed_${i + 1}.png`));
    const stream = drizzleCanvas.createPNGStream();
    stream.pipe(out);
    await new Promise((resolve) => out.on('finish', resolve));
  }

  const averaged = new Uint8ClampedArray(accumulator.length);
  for (let i = 0; i < accumulator.length; i += 4) {
    averaged[i] = Math.min(255, accumulator[i] / NUM_IMAGES);       // Red
    averaged[i + 1] = Math.min(255, accumulator[i + 1] / NUM_IMAGES); // Green
    averaged[i + 2] = Math.min(255, accumulator[i + 2] / NUM_IMAGES);     // Blue
    averaged[i + 3] = 255;
  }

  const patternAveraged = new Uint8ClampedArray(patternAccumulator.length);
  for (let i = 0; i < patternAccumulator.length; i += 4) {
    patternAveraged[i] = Math.min(255, patternAccumulator[i] / NUM_IMAGES);       // Red
    patternAveraged[i + 1] = Math.min(255, patternAccumulator[i + 1] / NUM_IMAGES); // Green (no need to adjust because of subpixel normalization)
    patternAveraged[i + 2] = Math.min(255, patternAccumulator[i + 2] / NUM_IMAGES);     // Blue
    patternAveraged[i + 3] = 255;
  }

  let averagePattern = 0;
  let sampleCount = 0
  for (let i = 0; i < patternAccumulator.length; i += 4) {
    averagePattern += patternAveraged[i];
    averagePattern += patternAveraged[i + 1];
    averagePattern += patternAveraged[i + 2];
    sampleCount += 3;
  }

  averagePattern /= sampleCount;

  for (let i = 0; i < accumulator.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const patternValue = patternAccumulator[i + c];
      if (patternValue > 0) {
        averaged[i + c] = Math.min(255, accumulator[i + c] / (patternValue / averagePattern / 4));
      } else {
        averaged[i + c] = 0;
      }
    }
    averaged[i + 3] = 255;
  }

  const highResCanvas = createCanvas(highResWidth, highResHeight);
  const highResCtx = highResCanvas.getContext('2d');
  const highResImageData = highResCtx.createImageData(highResWidth, highResHeight);
  highResImageData.data.set(averaged);
  highResCtx.putImageData(highResImageData, 0, 0);

  const out = fs.createWriteStream('reconstruct_unbayered_improved.png');
  const stream = highResCanvas.createPNGStream();
  stream.pipe(out);
  await new Promise((resolve) => out.on('finish', resolve));

  console.log('✅ Reconstructed image saved as "reconstruct_unbayered_improved.png"');

  getScore('./M81-M82-1024.png', './reconstruct_unbayered_improved.png').then(score => {
    console.log('ssimulacra2 score:', score);
  });
}

reconstructImage().catch(console.error);
