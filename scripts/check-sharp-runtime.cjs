// Build-time smoke check using the packaged native module and runtime fonts.
// No application boot, credentials, network, or customer files are required.
const assert = require('node:assert/strict');
const sharp = require('sharp');

(async () => {
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40">' +
      '<rect width="80" height="40" fill="#ffffff"/>' +
      '<text x="4" y="28" font-family="DejaVu Sans" font-size="24" fill="#000000">QA</text>' +
      '</svg>'
  );
  const png = await sharp(svg).resize(40, 20).png().toBuffer();
  const metadata = await sharp(png).metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, 40);
  assert.equal(metadata.height, 20);
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.channels, 3);
  assert(
    data.some((value) => value < 200),
    'Text must render against the white background'
  );
  assert(
    data.some((value) => value === 255),
    'Background must remain visible'
  );
  console.log(`Sharp ${sharp.versions.sharp}: SVG text, resize, PNG encode/decode passed`);
})().catch((error) => {
  console.error('Sharp runtime smoke failed:', error);
  process.exitCode = 1;
});
