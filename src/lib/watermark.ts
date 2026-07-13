// Filigrane partagé (écran résultat + historique). Le texte est un placeholder à
// remplacer par le nom déposé de l'app.
export const GUEST_WATERMARK = 'DEMO MODE';

const defaultProxy = (u: string) => `/api/proxy?url=${encodeURIComponent(u)}`;

/** Récupère les octets d'une image (data URL, ou distante via fetch direct puis proxy). */
export async function fetchImageBlob(
  srcUrl: string,
  proxyUrlFor: (url: string) => string = defaultProxy,
): Promise<Blob | null> {
  if (srcUrl.startsWith('data:')) {
    try { return await (await fetch(srcUrl)).blob(); } catch { return null; }
  }
  try { const r = await fetch(srcUrl); if (r.ok) return await r.blob(); } catch { /* CORS → proxy */ }
  try { const r = await fetch(proxyUrlFor(srcUrl)); if (r.ok) return await r.blob(); } catch { /* ignore */ }
  return null;
}

/**
 * Incruste le filigrane DANS les pixels de l'image (≠ calque à l'écran) pour le
 * téléchargement des comptes non-abonnés. Renvoie un Blob JPEG, ou null si l'image
 * n'a pas pu être récupérée/dessinée (dans ce cas on ne livre PAS l'image propre).
 */
export async function createWatermarkedBlob(
  srcUrl: string,
  text: string,
  proxyUrlFor: (url: string) => string = defaultProxy,
): Promise<Blob | null> {
  try {
    const blob = await fetchImageBlob(srcUrl, proxyUrlFor);
    if (!blob) return null;

    const bmp = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0);

    const w = canvas.width, h = canvas.height;
    const fontSize = Math.max(20, Math.round(w * 0.032));
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate((-30 * Math.PI) / 180);
    ctx.font = `800 ${fontSize}px -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.30)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const stepX = ctx.measureText(text).width + fontSize * 3;
    const stepY = fontSize * 4;
    const diag = Math.sqrt(w * w + h * h);
    for (let y = -diag; y < diag; y += stepY) {
      for (let x = -diag; x < diag; x += stepX) {
        ctx.fillText(text, x, y);
      }
    }
    ctx.restore();

    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.92)
    );
  } catch (e) {
    console.warn('[WATERMARK] createWatermarkedBlob:', e);
    return null;
  }
}
