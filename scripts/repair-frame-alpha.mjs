import sharp from "sharp";

const [, , originalPath, generatedPath, outputPath, theme] = process.argv;

if (!originalPath || !generatedPath || !outputPath || !theme) {
  throw new Error("Usage: node repair-frame-alpha.mjs <original> <generated> <output> <theme>");
}

const themeConfig = {
  roxy: {
    backgroundLevels: [35, 49],
    chromaFloor: 4,
    distanceFloor: 10,
    chromaScale: 19,
    distanceScale: 18,
    centers: [[108, 834], [1538, 834]],
    innerRadius: 103,
    outerRadius: 119,
  },
  sylphiette: {
    backgroundLevels: [220, 227],
    chromaFloor: 3,
    distanceFloor: 8,
    chromaScale: 22,
    distanceScale: 19,
    centers: [[111, 824], [1538, 824]],
    innerRadius: 82,
    outerRadius: 102,
  },
  eris: {
    backgroundLevels: [243, 252],
    chromaFloor: 4,
    distanceFloor: 9,
    chromaScale: 18,
    distanceScale: 19,
    centers: [[109, 823], [1538, 823]],
    innerRadius: 101,
    outerRadius: 123,
  },
}[theme];

if (!themeConfig) throw new Error(`Unknown theme: ${theme}`);

const original = await sharp(originalPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const generated = await sharp(generatedPath).removeAlpha().raw().toBuffer({ resolveWithObject: true });

if (original.info.width !== generated.info.width || original.info.height !== generated.info.height) {
  throw new Error("Original and generated frame dimensions do not match");
}

const { width, height } = original.info;
const output = Buffer.from(original.data);
const clampByte = (value) => Math.max(0, Math.min(255, Math.round(value)));

for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const [cx, cy] of themeConfig.centers) {
      nearestDistance = Math.min(nearestDistance, Math.hypot(x - cx, y - cy));
    }
    if (nearestDistance >= themeConfig.outerRadius) continue;

    const generatedIndex = (y * width + x) * generated.info.channels;
    const outputIndex = (y * width + x) * 4;
    const r = generated.data[generatedIndex];
    const g = generated.data[generatedIndex + 1];
    const b = generated.data[generatedIndex + 2];
    const luminance = (r + g + b) / 3;
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    const backgroundDistance = Math.min(
      ...themeConfig.backgroundLevels.map((level) => Math.abs(luminance - level)),
    );
    const detectedAlpha = clampByte(Math.max(
      (chroma - themeConfig.chromaFloor) * themeConfig.chromaScale,
      (backgroundDistance - themeConfig.distanceFloor) * themeConfig.distanceScale,
    ));
    const generatedWeight = nearestDistance <= themeConfig.innerRadius
      ? 1
      : (themeConfig.outerRadius - nearestDistance)
        / (themeConfig.outerRadius - themeConfig.innerRadius);
    const originalAlpha = output[outputIndex + 3];

    output[outputIndex] = clampByte(output[outputIndex] * (1 - generatedWeight) + r * generatedWeight);
    output[outputIndex + 1] = clampByte(output[outputIndex + 1] * (1 - generatedWeight) + g * generatedWeight);
    output[outputIndex + 2] = clampByte(output[outputIndex + 2] * (1 - generatedWeight) + b * generatedWeight);
    output[outputIndex + 3] = clampByte(
      originalAlpha * (1 - generatedWeight) + detectedAlpha * generatedWeight,
    );
  }
}

await sharp(output, { raw: { width, height, channels: 4 } }).png().toFile(outputPath);
