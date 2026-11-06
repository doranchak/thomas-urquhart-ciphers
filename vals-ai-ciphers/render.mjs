// Captures animation.html frame-by-frame (deterministic renderAt(t)) and pipes PNGs into ffmpeg -> H.264 MP4.
// usage: node render.mjs <out.mp4> [fps=60] [maxFrames]
// needs:  npm i playwright-core   (+ a Chromium / chrome-headless-shell; set CHROME_PATH if not auto-found)
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const HTML = process.env.ANIM_HTML || path.join(here, 'animation.html');
const [out, fpsArg, maxArg] = process.argv.slice(2);
const FPS = parseInt(fpsArg || '60', 10);

const exe = process.env.CHROME_PATH || [
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell`,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find(p => fs.existsSync(p));

const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto('file://' + HTML + '?render=1');
await page.waitForFunction(() => window.READY === true);
await page.evaluate(() => document.fonts.ready);
const errs = await page.evaluate(() => window.DATA_ERRORS);
if (errs.length) { console.log('DATA ERRORS', errs); process.exit(1); }
const total = await page.evaluate(() => window.TIMELINE.total);
const frames = Math.min(Math.ceil(total * FPS), maxArg ? parseInt(maxArg, 10) : Infinity);

const ff = spawn('ffmpeg', [
  '-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
  '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-r', String(FPS),
  '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv',
  '-movflags', '+faststart', out,
], { stdio: ['pipe', 'inherit', 'inherit'] });
const done = new Promise(res => ff.on('close', res));

const t0 = Date.now();
for (let f = 0; f < frames; f++) {
  await page.evaluate(t => window.renderAt(t), f / FPS);
  const png = await page.screenshot({ type: 'png' });
  if (!ff.stdin.write(png)) await new Promise(r => ff.stdin.once('drain', r));
  if (f % 120 === 0) console.log(`frame ${f}/${frames}  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
ff.stdin.end();
const code = await done;
await browser.close();
console.log(`ffmpeg exit ${code}; ${frames} frames in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${out}`);
