import { ref, listAll, getDownloadURL, uploadString, deleteObject } from 'firebase/storage';
import { doc, setDoc, deleteDoc, serverTimestamp, collection, query, where, getDocs } from 'firebase/firestore';
import { storage, customDb } from './firebase';

export interface CustomAsset {
  name: string;
  url: string;
}

/** Découverte dynamique des assets du studio CUSTOM (l'utilisateur remplit les dossiers). */
// Nomenclature Storage : les dossiers du studio CUSTOM vivent sous
// ENVIRONMENTS/CUSTOM/ (EXAMPLES, FONDS, SOLS) — même racine que les autres fonds.
const CUSTOM_ROOT = 'ENVIRONMENTS/CUSTOM';
export async function listCustomFolder(sub: 'EXAMPLES' | 'SOLS' | 'FONDS'): Promise<CustomAsset[]> {
  try {
    const res = await listAll(ref(storage, `${CUSTOM_ROOT}/${sub}`));
    const items = await Promise.all(
      res.items.map(async (it) => ({ name: it.name, url: await getDownloadURL(it) })),
    );
    return items.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  } catch (e) {
    console.warn(`[CUSTOM] listage de ${CUSTOM_ROOT}/${sub} échoué:`, e);
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

/** Nombre maximum de fonds custom conservés par utilisateur. */
export const MAX_SAVED_BACKGROUNDS = 10;

/**
 * Liste les fonds custom déjà enregistrés par l'utilisateur (fiches Firestore
 * `custom_backgrounds` filtrées sur userId — exigé par les règles de lecture).
 * Tri CHRONOLOGIQUE croissant (le plus ancien en premier) : l'UI les nomme
 * « Fond 1 » → « Fond 10 » dans l'ordre de création. Tri client pour éviter
 * d'exiger un index composite.
 */
export async function listSavedCustomBackgrounds(uid: string): Promise<CustomAsset[]> {
  try {
    const snap = await getDocs(query(collection(customDb, 'custom_backgrounds'), where('userId', '==', uid)));
    return snap.docs
      .map((d) => {
        const data = d.data() as any;
        return { name: d.id, url: String(data?.url || ''), createdAt: data?.createdAt?.toMillis?.() ?? 0 };
      })
      .filter((a) => !!a.url)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(({ name, url }) => ({ name, url }));
  } catch (e) {
    console.warn('[CUSTOM] listage des fonds enregistrés échoué:', e);
    return [];
  }
}

/**
 * Supprime un fond custom : fiche Firestore + fichier Storage.
 * `id` est l'identifiant de la fiche (= nom du fichier `{id}.jpg` dans
 * users/{uid}/custom_backgrounds/, voir saveCustomBackground).
 */
export async function deleteCustomBackground(uid: string, id: string): Promise<void> {
  await deleteDoc(doc(customDb, 'custom_backgrounds', id));
  try {
    await deleteObject(ref(storage, `users/${uid}/custom_backgrounds/${id}.jpg`));
  } catch (e) {
    // Fichier déjà absent ou règle Storage restrictive : la fiche est supprimée,
    // le fond n'apparaît plus dans l'UI — on ne bloque pas pour un orphelin.
    console.warn('[CUSTOM] suppression du fichier Storage échouée (fiche supprimée):', e);
  }
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
