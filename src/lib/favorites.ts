import { doc, getDoc, setDoc } from 'firebase/firestore';
import { customDb } from './firebase';

export interface FavItem {
  envCategory: string | null;
  envVariant: string | null;
}

export const MAX_FAVORITES = 10;
const LS_KEY = 'pwa_favorites';

/** Ne garde que les favoris réels (avec un envVariant), borné à MAX_FAVORITES. */
export const compactFavorites = (favs: (FavItem | null)[]): FavItem[] =>
  favs
    .filter((f): f is FavItem => !!f && typeof f.envVariant === 'string' && f.envVariant.length > 0)
    .slice(0, MAX_FAVORITES);

/** Complète (ou tronque) une liste compacte à un tableau de MAX_FAVORITES cases (null = vide). */
export const padFavorites = (favs: (FavItem | null)[]): (FavItem | null)[] => {
  const clean = compactFavorites(favs);
  const out: (FavItem | null)[] = clean.slice(0, MAX_FAVORITES);
  while (out.length < MAX_FAVORITES) out.push(null);
  return out;
};

/** Cache local instantané (fonctionne pour les invités et avant le retour Firestore). */
export const loadLocalFavorites = (): FavItem[] => {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? compactFavorites(arr) : [];
  } catch {
    return [];
  }
};

export const saveLocalFavorites = (favs: (FavItem | null)[]): void => {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(compactFavorites(favs)));
  } catch {
    /* quota / mode privé : on ignore */
  }
};

/** Favoris de l'utilisateur connecté (cross-device + « Mes favoris »). */
export async function loadFavorites(uid: string): Promise<FavItem[]> {
  try {
    const snap = await getDoc(doc(customDb, 'favorites', uid));
    const arr = snap.exists() ? (snap.data() as any)?.items : null;
    return Array.isArray(arr) ? compactFavorites(arr) : [];
  } catch (e) {
    console.warn('[FAV] lecture échouée:', e);
    return [];
  }
}

export async function saveFavorites(uid: string, favs: (FavItem | null)[]): Promise<boolean> {
  try {
    await setDoc(doc(customDb, 'favorites', uid), { items: compactFavorites(favs) }, { merge: true });
    return true;
  } catch (e) {
    console.warn('[FAV] écriture échouée:', e);
    return false;
  }
}
