import { ref, listAll, getDownloadURL, uploadString } from 'firebase/storage';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { storage, customDb } from './firebase';

export interface CustomAsset {
  name: string;
  url: string;
}

/** Découverte dynamique des assets du studio CUSTOM (l'utilisateur remplit les dossiers). */
export async function listCustomFolder(sub: 'EXAMPLES' | 'SOLS' | 'FONDS'): Promise<CustomAsset[]> {
  try {
    const res = await listAll(ref(storage, `CUSTOM/${sub}`));
    const items = await Promise.all(
      res.items.map(async (it) => ({ name: it.name, url: await getDownloadURL(it) })),
    );
    return items.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  } catch (e) {
    console.warn(`[CUSTOM] listage de CUSTOM/${sub} échoué:`, e);
    return [];
  }
}

export interface GenerateBgParams {
  baseImage?: string | null;
  groundImage?: string | null;
  topImage?: string | null;
  color?: string | null;
  logo?: string | null;
  logoMaterialPrompt?: string | null;
  extraPrompt?: string | null;
}

/** Appelle le moteur (app-API) pour générer un fond premium. Renvoie une data URL. */
export async function generateBackground(apiUrl: string, params: GenerateBgParams): Promise<string> {
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.image) {
    throw new Error(data?.error || `Génération du fond échouée (${res.status}).`);
  }
  return data.image as string;
}

/**
 * Enregistre un fond généré : upload dans Storage (users/{uid}/custom_backgrounds)
 * + fiche Firestore `custom_backgrounds/{id}` pour le retrouver / le rendre sélectionnable.
 */
export async function saveCustomBackground(
  uid: string,
  dataUrl: string,
): Promise<{ id: string; url: string }> {
  const id = `${uid}_${Date.now()}`;
  const sref = ref(storage, `users/${uid}/custom_backgrounds/${id}.jpg`);
  await uploadString(sref, dataUrl, 'data_url');
  const url = await getDownloadURL(sref);
  await setDoc(doc(customDb, 'custom_backgrounds', id), {
    userId: uid,
    url,
    createdAt: serverTimestamp(),
  });
  return { id, url };
}
