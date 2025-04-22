import sharp from 'sharp';
import { createCanvas, loadImage } from 'canvas';
import fs from 'fs';
import path from 'path';

const OUTPUT_DIR = './output';
const NUM_IMAGES = 32;
const TARGET_WIDTH = 256;
const TARGET_HEIGHT = 256;
const HIGH_RES_FACTOR = 4; // upscale factor to allow subpixel dithering
const DITHER_PIXELS = 40; // max subpixel jitter in high-res space

const transforms: { dx: number; dy: number; rotation: number }[] = [];

// RGGB Bayer pattern
function applyBayerPattern(imageData: Uint8ClampedArray, width: number, height: number) {
  const bayered = new Uint8ClampedArray(imageData.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const [r, g, b] = [imageData[idx], imageData[idx + 1], imageData[idx + 2]];

      if (y % 2 === 0) {
        if (x % 2 === 0) {
          // Red
          bayered[idx] = r;
          bayered[idx + 1] = 0;
          bayered[idx + 2] = 0;
        } else {
          // Green
          bayered[idx] = 0;
          bayered[idx + 1] = g;
          bayered[idx + 2] = 0;
        }
      } else {
        if (x % 2 === 0) {
          // Green
          bayered[idx] = 0;
          bayered[idx + 1] = g;
          bayered[idx + 2] = 0;
        } else {
          // Blue
          bayered[idx] = 0;
          bayered[idx + 1] = 0;
          bayered[idx + 2] = b;
        }
      }

      bayered[idx + 3] = 255; // alpha
    }
  }
  return bayered;
}

async function simulate(inputPath: string) {
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);
  
    const highResWidth = TARGET_WIDTH * HIGH_RES_FACTOR;
    const highResHeight = TARGET_HEIGHT * HIGH_RES_FACTOR;
  
    for (let i = 0; i < NUM_IMAGES; i++) {
      const rotation = Math.floor(Math.random() * 360);
      const dx = (Math.random() - 0.5) * DITHER_PIXELS;
      const dy = (Math.random() - 0.5) * DITHER_PIXELS;
      transforms.push({ dx, dy, rotation });
  
      // Rotate and resize to high-res
      const buffer = await sharp(inputPath)
        .resize(highResWidth, highResHeight, { fit: 'cover'})
        .toBuffer();
  
      const img = await loadImage(buffer);
      const highResCanvas = createCanvas(highResWidth, highResHeight);
      const highResCtx = highResCanvas.getContext('2d');
  
      // Apply subpixel dithering (translation)
      //highResCtx.translate(dx, dy); 
      highResCtx.drawImage(img, 0, 0);

      // Apply transform: rotate around center, then shift
      highResCtx.translate(highResWidth / 2, highResHeight / 2);
      //highResCtx.rotate((rotation * Math.PI) / 180);
      highResCtx.translate(dx, dy);

      // Draw centered image
      highResCtx.drawImage(img, -highResWidth / 2, -highResHeight / 2, highResWidth, highResHeight);
  
      // Downsample with area averaging to target size
      const downsampleCanvas = createCanvas(TARGET_WIDTH, TARGET_HEIGHT);
      const downsampleCtx = downsampleCanvas.getContext('2d');
      downsampleCtx.drawImage(highResCanvas, 0, 0, TARGET_WIDTH, TARGET_HEIGHT);
  
      const imageData = downsampleCtx.getImageData(0, 0, TARGET_WIDTH, TARGET_HEIGHT);
      let pixels = imageData.data;
  
      // Bayer pattern + (optional) additive noise
      pixels = applyBayerPattern(pixels, TARGET_WIDTH, TARGET_HEIGHT);
  
      const outputImage = downsampleCtx.createImageData(TARGET_WIDTH, TARGET_HEIGHT);
      outputImage.data.set(pixels);
      downsampleCtx.putImageData(outputImage, 0, 0);
  
      // Export result
      const out = fs.createWriteStream(path.join(OUTPUT_DIR, `bayered_${i + 1}.png`));
      const stream = downsampleCanvas.createPNGStream();
      stream.pipe(out);
      await new Promise((resolve) => out.on('finish', resolve));
    }
  
    console.log(`Generated ${NUM_IMAGES} Bayered images with subpixel dithering in "${OUTPUT_DIR}"`);

    fs.writeFileSync(path.join(OUTPUT_DIR, 'transforms.json'), JSON.stringify(transforms, null, 2));
  }

simulate('M81-M82.png').catch(console.error);