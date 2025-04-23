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

  
      // Export result
      const out = fs.createWriteStream(path.join(OUTPUT_DIR, `unbayered_${i + 1}.png`));
      const stream = downsampleCanvas.createPNGStream();
      stream.pipe(out);
      await new Promise((resolve) => out.on('finish', resolve));
    }
  
    console.log(`Generated ${NUM_IMAGES} unbayered images with subpixel dithering in "${OUTPUT_DIR}"`);

    fs.writeFileSync(path.join(OUTPUT_DIR, 'transforms.json'), JSON.stringify(transforms, null, 2));
  }

simulate('M81-M82.png').catch(console.error);