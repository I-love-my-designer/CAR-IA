import React, { useEffect, useState } from 'react';
import { loadFavorites, saveFavorites, type FavItem, MAX_FAVORITES } from '../lib/favorites';
import { envThumbUrl, STORAGE_PREFIX_MAP } from '../lib/envAssets';

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

const FavorisModal: React.FC<Props> = ({ open, onClose, userId }) => {
  const [items, setItems] = useState<FavItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !userId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const favs = await loadFavorites(userId);
      if (!cancelled) { setItems(favs); setLoading(false); setConfirmId(null); }
    })();
    return () => { cancelled = true; };
  }, [open, userId]);

  if (!open) return null;

  const remove = async (variant: string | null) => {
    if (!userId) return;
    const next = items.filter((f) => f.envVariant !== variant);
    setItems(next);
    setConfirmId(null);
    await saveFavorites(userId, next);
    // Garde le sélecteur d'environnement (autre arbre React) synchronisé.
    window.dispatchEvent(new CustomEvent('carai:favoris-changed', { detail: next }));
  };

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
          <h2 className="text-base font-bold">
            Mes favoris <span className="ml-1 text-xs font-normal text-white/40">{items.length}/{MAX_FAVORITES}</span>
          </h2>
          <button onClick={onClose} className="text-xl leading-none text-white/40 hover:text-white">×</button>
        </div>

        <div className="min-h-[180px] flex-1 overflow-y-auto p-6">
          {loading && <p className="py-10 text-center text-sm text-white/40">Chargement…</p>}

          {!loading && items.length === 0 && (
            <div className="py-14 text-center">
              <div className="mb-3 text-3xl">⭐</div>
              <p className="text-sm text-white/60">Aucun fond favori pour l'instant.</p>
              <p className="mt-1 text-xs text-white/40">
                Ajoutez-en depuis l'écran <span className="font-semibold text-white/60">Environment</span> en touchant un emplacement ♡.
              </p>
            </div>
          )}

          {!loading && items.length > 0 && (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {items.map((fav) => {
                const confirming = confirmId === fav.envVariant;
                return (
                  <div key={fav.envVariant} className="group relative overflow-hidden rounded-lg border border-white/10 bg-black">
                    <img
                      src={envThumbUrl(fav.envVariant)}
                      alt={favLabel(fav.envVariant)}
                      referrerPolicy="no-referrer"
                      loading="lazy"
                      className="aspect-square w-full object-cover opacity-90"
                    />
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 pb-1.5 pt-4">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-white/90">{favLabel(fav.envVariant)}</span>
                    </div>

                    {confirming ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/80 p-2 text-center">
                        <span className="text-[11px] text-white/80">Retirer&nbsp;?</span>
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => remove(fav.envVariant)}
                            className="rounded bg-red-500 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white hover:bg-red-400"
                          >
                            Retirer
                          </button>
                          <button
                            onClick={() => setConfirmId(null)}
                            className="rounded bg-white/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white/70 hover:bg-white/20"
                          >
                            Annuler
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmId(fav.envVariant)}
                        title="Retirer des favoris"
                        className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-sm opacity-0 transition-opacity hover:bg-red-500/80 group-hover:opacity-100"
                      >
                        🗑️
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t border-white/10 px-6 py-3 text-center text-[11px] text-white/45">
          Retrouvez et appliquez vos favoris directement sur l'écran « Environment ».
        </div>
      </div>
    </div>
  );
};

export default FavorisModal;
