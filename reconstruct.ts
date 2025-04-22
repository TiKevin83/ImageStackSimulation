import fs from 'fs';
import path from 'path';
import { createCanvas, loadImage } from 'canvas';
import { getScore } from '@nrs-binding/ssimulacra2';

const INPUT_DIR = './output';
const OUTPUT_DIR = './reconstructions';
const NUM_IMAGES = 32;
const WIDTH = 256;
const HEIGHT = 256;
const HIGH_RES_FACTOR = 4;

function demosaicBayer(imageData: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
    const result = new Uint8ClampedArray(imageData.length);
  
    function getPixel(x: number, y: number, c: number): number {
      if (x < 0 || x >= width || y < 0 || y >= height) return 0;
      return imageData[(y * width + x) * 4 + c];
    }
  
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
  
        const isRed = (y % 2 === 0) && (x % 2 === 0);
        const isBlue = (y % 2 === 1) && (x % 2 === 1);
  
        // Simple bilinear demosaicing
        let r, g, b;
  
        if (isRed) {
          r = getPixel(x, y, 0);
          g = (getPixel(x - 1, y, 1) + getPixel(x + 1, y, 1) + getPixel(x, y - 1, 1) + getPixel(x, y + 1, 1)) / 4;
          b = (getPixel(x - 1, y - 1, 2) + getPixel(x + 1, y - 1, 2) + getPixel(x - 1, y + 1, 2) + getPixel(x + 1, y + 1, 2)) / 4;
        } else if (isBlue) {
          b = getPixel(x, y, 2);
          g = (getPixel(x - 1, y, 1) + getPixel(x + 1, y, 1) + getPixel(x, y - 1, 1) + getPixel(x, y + 1, 1)) / 4;
          r = (getPixel(x - 1, y - 1, 0) + getPixel(x + 1, y - 1, 0) + getPixel(x - 1, y + 1, 0) + getPixel(x + 1, y + 1, 0)) / 4;
        } else {
          g = getPixel(x, y, 1);
          if (y % 2 === 0) {
            r = (getPixel(x - 1, y, 0) + getPixel(x + 1, y, 0)) / 2;
            b = (getPixel(x, y - 1, 2) + getPixel(x, y + 1, 2)) / 2;
          } else {
            b = (getPixel(x - 1, y, 2) + getPixel(x + 1, y, 2)) / 2;
            r = (getPixel(x, y - 1, 0) + getPixel(x, y + 1, 0)) / 2;
          }
        }
  
        result[idx] = r;
        result[idx + 1] = g;
        result[idx + 2] = b;
        result[idx + 3] = 255;
      }
    }
  
    return result;
  }

async function reconstructImage() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

  const transforms = JSON.parse(fs.readFileSync(path.join(INPUT_DIR, 'transforms.json'), 'utf8')) as { dx: number; dy: number; rotation: number }[];

  const highResWidth = WIDTH * HIGH_RES_FACTOR;
  const highResHeight = HEIGHT * HIGH_RES_FACTOR;

  const accumulator = new Float32Array(highResWidth * highResHeight * 4);

  for (let i = 0; i < NUM_IMAGES; i++) {
    const filePath = path.join(INPUT_DIR, `bayered_${i + 1}.png`);
    const img = await loadImage(filePath);

    const canvas = createCanvas(highResWidth, highResHeight);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    const transform = transforms[i];
    //const angleRad = -transform.rotation * (Math.PI / 180); // inverse rotation

    ctx.translate((highResWidth / 2) - transform.dx, (highResHeight / 2) - transform.dy);
    //ctx.rotate(angleRad);
    ctx.drawImage(img, -highResWidth / 2, -highResHeight / 2, highResWidth, highResHeight);

    const imageData = ctx.getImageData(0, 0, highResWidth, highResHeight);
    const data = imageData.data;

    for (let j = 0; j < data.length; j++) {
      accumulator[j] += data[j];
    }

    // Export result
    const out = fs.createWriteStream(path.join(OUTPUT_DIR, `reconstructed_${i + 1}.png`));
    const stream = canvas.createPNGStream();
    stream.pipe(out);
    await new Promise((resolve) => out.on('finish', resolve));
  }

  const averaged = new Uint8ClampedArray(accumulator.length);
  for (let i = 0; i < accumulator.length; i += 4) {
    averaged[i] = Math.min(255, accumulator[i] / NUM_IMAGES * 4);       // Red
    averaged[i + 1] = Math.min(255, accumulator[i + 1] / NUM_IMAGES * 2); // Green (adjusted!)
    averaged[i + 2] = Math.min(255, accumulator[i + 2] / NUM_IMAGES * 4);     // Blue
    averaged[i + 3] = 255;
  }

  const highResCanvas = createCanvas(highResWidth, highResHeight);
  const highResCtx = highResCanvas.getContext('2d');
  const highResImageData = highResCtx.createImageData(highResWidth, highResHeight);
  highResImageData.data.set(averaged);
  highResCtx.putImageData(highResImageData, 0, 0);

  const out = fs.createWriteStream('reconstructed.png');
  const stream = highResCanvas.createPNGStream();
  stream.pipe(out);
  await new Promise((resolve) => out.on('finish', resolve));

  console.log('✅ Reconstructed image saved as "reconstructed.png"');

  getScore('./M81-M82-1024.png', './reconstructed.png').then(score => {
    console.log('ssimulacra2 score:', score);
  });
}

reconstructImage().catch(console.error);
