// Analyse de l'accent lumineux (néon/LED) d'un fond, 100 % client (sans IA) :
//  - détecte la teinte SATURÉE dominante (ignore marbre/neutre) → couleur de départ
//  - construit un MASQUE des pixels du néon → sert à teinter UNIQUEMENT le néon en CSS
import { fetchImageBlob } from './watermark';

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
      case g: h = ((b - r) / d + 2); break;
      default: h = ((r - g) / d + 4); break;
    }
    h *= 60;
  }
  return { h, s, l };
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

const hueDist = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

export interface NeonAnalysis { hex: string; mask: string }

/**
 * Renvoie { hex, mask } pour le néon dominant d'une image, ou null si l'image est
 * globalement neutre. `mask` = data URL PNG (blanc alpha = néon) à utiliser en
 * CSS mask-image pour teinter uniquement le néon.
 */
export async function analyzeNeon(
  url: string,
  proxyUrlFor?: (u: string) => string,
): Promise<NeonAnalysis | null> {
  try {
    const blob = await fetchImageBlob(url, proxyUrlFor);
    if (!blob) return null;
    const bmp = await createImageBitmap(blob);
    const W = 384;
    const H = Math.max(1, Math.round((W * bmp.height) / bmp.width));
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0, W, H);
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;

    // 1) Teinte dominante saturée
    const N = 36;
    const weight = new Array(N).fill(0), sAcc = new Array(N).fill(0), lAcc = new Array(N).fill(0);
    for (let i = 0; i < d.length; i += 4) {
      const { h, s, l } = rgbToHsl(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255);
      if (s < 0.35 || l < 0.12 || l > 0.92) continue;
      const bi = Math.min(N - 1, Math.floor(h / 10));
      const w = s * (1 - Math.abs(l - 0.55));
      weight[bi] += w; sAcc[bi] += s * w; lAcc[bi] += l * w;
    }
    let best = -1, bestVal = 0;
    for (let i = 0; i < N; i++) if (weight[i] > bestVal) { bestVal = weight[i]; best = i; }
    if (best < 0 || bestVal <= 0) return null;
    const domHue = best * 10 + 5;
    const hex = hslToHex(
      domHue,
      Math.max(0.55, Math.min(1, sAcc[best] / weight[best])),
      Math.max(0.42, Math.min(0.68, lAcc[best] / weight[best])),
    );

    // 2) Masque : blanc (alpha) là où c'est le néon (saturé + teinte proche + assez lumineux)
    const mask = ctx.createImageData(W, H);
    const md = mask.data;
    for (let i = 0; i < d.length; i += 4) {
      const { h, s, l } = rgbToHsl(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255);
      let a = 0;
      if (s >= 0.3 && l >= 0.18 && l <= 0.97 && hueDist(h, domHue) <= 30) {
        a = Math.min(1, s * (0.5 + l)); // plus saturé/lumineux = plus opaque
      }
      md[i] = 255; md[i + 1] = 255; md[i + 2] = 255; md[i + 3] = Math.round(a * 255);
    }
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = W; maskCanvas.height = H;
    const mctx = maskCanvas.getContext('2d');
    if (!mctx) return null;
    mctx.putImageData(mask, 0, 0);
    // Léger flou → halo du néon plus naturel
    const glow = document.createElement('canvas');
    glow.width = W; glow.height = H;
    const gctx = glow.getContext('2d');
    if (!gctx) return null;
    gctx.filter = 'blur(2px)';
    gctx.drawImage(maskCanvas, 0, 0);

    return { hex, mask: glow.toDataURL('image/png') };
  } catch {
    return null;
  }
}
