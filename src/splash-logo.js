import { inflateSync } from 'node:zlib';

// 32×28 RGBA sample of the logo supplied for the terminal splash.
// Kept as data so the running CLI needs no image decoder or external file.
export const SPLASH_LOGO_WIDTH = 32;
export const SPLASH_LOGO_HEIGHT = 28;
export const splashLogo = inflateSync(Buffer.from(
  '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',
  'base64',
));
