import React, { useEffect, useState } from 'react';
import { Star, Trash2, Wand2, X } from 'lucide-react';
import { loadFavorites, saveFavorites, type FavItem, MAX_FAVORITES } from '../lib/favorites';
import { envThumbUrl, STORAGE_PREFIX_MAP } from '../lib/envAssets';
import {
  listSavedCustomBackgrounds, deleteCustomBackground, MAX_SAVED_BACKGROUNDS, type CustomAsset,
} from '../lib/customStudio';

interface Props {
  open: boolean;
  onClose: () => void;
  userId: string | null;
}

const favLabel = (code: string | null): string => {
  if (!code) return 'Fond';
  const prefix = STORAGE_PREFIX_MAP[code.substring(0, 5)];
  return prefix || code;
};

/** Élément affiché en grand dans le popup de prévisualisation. */
interface PreviewItem {
  kind: 'fav' | 'custom';
  id: string;      // envVariant (fav) ou id de fiche (custom)
  url: string;
  label: string;
}

// « Mes fonds » : regroupe les fonds FAVORIS (environnements du catalogue
// épinglés ♡) et les fonds GÉNÉRÉS par l'utilisateur via le studio CUSTOM.
// Mobile-first : corbeille TOUJOURS visible (pas de survol), tap sur la
// vignette → popup de prévisualisation en grand (croix + corbeille).
const FavorisModal: React.FC<Props> = ({ open, onClose, userId }) => {
  const [items, setItems] = useState<FavItem[]>([]);
  const [customs, setCustoms] = useState<CustomAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewItem | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open || !userId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setPreview(null);
      setConfirmDelete(false);
      const [favs, gens] = await Promise.all([
        loadFavorites(userId),
        listSavedCustomBackgrounds(userId),
      ]);
      if (!cancelled) { setItems(favs); setCustoms(gens); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [open, userId]);

  if (!open) return null;

  const removeFav = async (variant: string) => {
    if (!userId) return;
    const next = items.filter((f) => f.envVariant !== variant);
    setItems(next);
    await saveFavorites(userId, next);
    // Garde le sélecteur d'environnement (autre arbre React) synchronisé.
    window.dispatchEvent(new CustomEvent('carai:favoris-changed', { detail: next }));
  };

  const removeCustom = async (id: string) => {
    if (!userId) return;
    try {
      await deleteCustomBackground(userId, id);
      setCustoms((prev) => prev.filter((a) => a.name !== id));
    } catch (e) {
      console.warn('[MES FONDS] suppression du fond généré échouée:', e);
    }
  };

  const deleteFromPreview = async () => {
    if (!preview) return;
    if (preview.kind === 'fav') await removeFav(preview.id);
    else await removeCustom(preview.id);
    setConfirmDelete(false);
    setPreview(null);
  };

  // Vignette : image cliquable (→ preview) + barre du bas avec nom (police
  // réduite) à gauche et corbeille à droite — pas de chevauchement.
  const Tile: React.FC<{ item: PreviewItem }> = ({ item }) => (
    <div className="relative overflow-hidden rounded-lg border border-white/10 bg-black">
      <button onClick={() => { setPreview(item); setConfirmDelete(false); }} className="block w-full">
        <img
          src={item.url}
          alt={item.label}
          referrerPolicy="no-referrer"
          loading="lazy"
          className="aspect-square w-full object-cover opacity-90"
        />
      </button>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-1 bg-gradient-to-t from-black/85 to-transparent px-1.5 pb-1 pt-4">
        <span className="truncate text-[7.5px] font-bold uppercase tracking-[0.12em] text-white/90 leading-tight">
          {item.label}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); setPreview(item); setConfirmDelete(true); }}
          title="Retirer"
          className="pointer-events-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-black/60 text-white/70 active:bg-red-500/80 active:text-white"
        >
          <Trash2 size={11} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );

  const isEmpty = items.length === 0 && customs.length === 0;

  return (
    <div
      className="fixed inset-0 z-[9996] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-white/10 bg-zinc-900 text-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <h2 className="text-base font-bold">Mes fonds</h2>
          <button onClick={onClose} className="text-xl leading-none text-white/40 hover:text-white">×</button>
        </div>

        <div className="min-h-[180px] flex-1 overflow-y-auto p-6">
          {loading && <p className="py-10 text-center text-sm text-white/40">Chargement…</p>}

          {!loading && isEmpty && (
            <div className="py-14 text-center">
              <Star size={28} strokeWidth={1.25} className="mx-auto mb-3 text-white/30" />
              <p className="text-sm text-white/60">Aucun fond pour l'instant.</p>
              <p className="mt-1 text-xs text-white/40">
                Épinglez un favori ♡ depuis l'écran <span className="font-semibold text-white/60">Environment</span>,
                ou générez un fond dans le studio <span className="font-semibold text-white/60">Custom</span>.
              </p>
            </div>
          )}

          {/* Section 1 — favoris du catalogue (jaune doré, comme les épingles) */}
          {!loading && items.length > 0 && (
            <div className="mb-6">
              <p className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-amber-300/80">
                <Star size={12} strokeWidth={1.5} />
                Favoris <span className="font-normal text-white/35">{items.length}/{MAX_FAVORITES}</span>
              </p>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                {items.map((fav) => (
                  <Tile
                    key={fav.envVariant}
                    item={{ kind: 'fav', id: fav.envVariant!, url: envThumbUrl(fav.envVariant), label: favLabel(fav.envVariant) }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Section 2 — fonds générés par l'utilisateur (studio CUSTOM) */}
          {!loading && customs.length > 0 && (
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-emerald-300/70">
                <Wand2 size={12} strokeWidth={1.5} />
                Fonds générés <span className="font-normal text-white/35">{customs.length}/{MAX_SAVED_BACKGROUNDS}</span>
              </p>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                {customs.map((a, i) => (
                  <Tile
                    key={a.url}
                    item={{ kind: 'custom', id: a.name, url: a.url, label: `Fond ${i + 1}` }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-white/10 px-6 py-3 text-center text-[11px] text-white/45">
          Favoris : applicables depuis l'écran « Environment » · Fonds générés : réutilisables dans le studio Custom.
        </div>
      </div>

      {/* Popup de prévisualisation en grand : croix pour fermer, corbeille pour
          supprimer (avec confirmation) — pensé pour le tactile. */}
      {preview && (
        <div
          className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm"
          onClick={() => { setPreview(null); setConfirmDelete(false); }}
        >
          <div
            className="w-full max-w-lg overflow-hidden rounded-2xl border border-white/15 bg-zinc-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
              <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-white/80">{preview.label}</span>
              <button
                onClick={() => { setPreview(null); setConfirmDelete(false); }}
                aria-label="Fermer"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-white/60 active:bg-white/20 active:text-white"
              >
                <X size={16} strokeWidth={1.5} />
              </button>
            </div>

            <img src={preview.url} alt={preview.label} referrerPolicy="no-referrer" className="aspect-square w-full object-cover" />

            <div className="flex items-center justify-between gap-2 border-t border-white/10 px-4 py-3">
              {confirmDelete ? (
                <>
                  <span className="text-[11px] text-white/70">Retirer ce fond&nbsp;?</span>
                  <div className="flex gap-1.5">
                    <button
                      onClick={deleteFromPreview}
                      className="rounded bg-red-500 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-white active:bg-red-400"
                    >
                      Retirer
                    </button>
                    <button
                      onClick={() => setConfirmDelete(false)}
                      className="rounded bg-white/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-white/70 active:bg-white/20"
                    >
                      Annuler
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <span className="text-[10px] uppercase tracking-widest text-white/35">
                    {preview.kind === 'fav' ? 'Favori du catalogue' : 'Fond généré (Custom)'}
                  </span>
                  <button
                    onClick={() => setConfirmDelete(true)}
                    title="Retirer"
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/70 active:bg-red-500/80 active:text-white"
                  >
                    <Trash2 size={15} strokeWidth={1.5} />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FavorisModal;
