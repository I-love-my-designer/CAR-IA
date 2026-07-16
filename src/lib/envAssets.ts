// Source de vérité UNIQUE pour l'emplacement Storage des fonds « Environment » (07…)
// et la construction de leur URL publique Firebase. Importé par App.tsx (rendu du
// sélecteur) ET par FavorisModal.tsx (vignettes des favoris) → pas de duplication.

export const STORAGE_PREFIX_MAP: Record<string, string> = {
  // 1. URBAN (07A)
  '07A01': 'CITY',
  '07A02': 'SPORT',
  '07A03': 'INDUS',
  '07A04': 'PARKING',

  // 2. NATURE (07B)
  '07B01': 'DESERT',
  '07B02': 'FOREST',
  '07B03': 'MONTAGNE',
  '07B04': 'SEASIDE',

  // 3. DESIGN (07C)
  '07C01': 'OUTSIDE',
  '07C02': 'STUDIO',
  '07C03': 'CONCRETE',
  '07C04': 'LED',

  // 4. MINIMAL (07D)
  '07D01': 'LANDSCAPE',
  '07D02': 'ARCHI',
  '07D03': 'MTX',
  '07D04': 'VGX',
};

export const letterToTwoDigits = (letter: string): string => {
  if (!letter || letter.length !== 1) return '01';
  const code = letter.toUpperCase().charCodeAt(0) - 64; // A = 1, B = 2, C = 3...
  if (code < 1 || code > 26) return '01';
  return code < 10 ? `0${code}` : `${code}`;
};

// URL publique Firebase Storage d'un fond (ENVIRONMENTS/{STYLE}/{STYLE NN}.jpg).
// Renvoie null si le code n'est pas un fond « 07 » mappé.
export const getFirebaseStorageAssetUrl = (effectiveCode: string): string | null => {
  if (!effectiveCode || effectiveCode.length < 5 || !effectiveCode.startsWith('07')) {
    return null;
  }
  const baseCode = effectiveCode.substring(0, 5); // e.g. "07A01"
  const prefix = STORAGE_PREFIX_MAP[baseCode];
  if (!prefix) return null;

  const letter = effectiveCode.substring(5) || 'A';
  const indexStr = letterToTwoDigits(letter); // e.g. "01"
  const filename = `${prefix} ${indexStr}.jpg`;

  const bucketName = 'gen-lang-client-0870404092.firebasestorage.app';
  const encodedPath = encodeURIComponent(`ENVIRONMENTS/${prefix}/${filename}`);
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedPath}?alt=media`;
};

// Vignette d'un favori depuis son code de variante (ex. "07C04A"). Tolère un code
// déjà en majuscules ou non ; renvoie '' si non résoluble.
export const envThumbUrl = (code: string | null | undefined): string => {
  if (!code) return '';
  return getFirebaseStorageAssetUrl(code.trim().toUpperCase()) || '';
};
