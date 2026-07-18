import React, { useEffect, useState } from 'react';
import { collection, query, where, limit, getDocs, deleteDoc, doc } from 'firebase/firestore';
import { Star, Trash2, Download, X, Images, ArrowDownWideNarrow, ArrowUpNarrowWide } from 'lucide-react';
import { customDb } from '../lib/firebase';
import { createWatermarkedBlob, fetchImageBlob, GUEST_WATERMARK } from '../lib/watermark';
import { loadAnnonceFavorites, saveAnnonceFavorites, MAX_ANNONCE_FAVORITES } from '../lib/favorites';

interface HistItem {
  id: string;
  imageUrl: string;
  timestamp?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  userId: string | null;
  /** true = compte payant → téléchargement propre ; sinon filigrané. */
  isEntitled: boolean;
}

const triggerDownload = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const formatDate = (t?: string): string => {
  if (!t) return 'Date inconnue';
  const d = new Date(t);
  if (isNaN(d.getTime())) return 'Date inconnue';
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
    + ' · ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
};

// « Mes annonces » — LISTE DENSE (type Vinted/boîte mail) : rangées fines avec
// mini-vignette + date + actions toujours visibles (mobile : pas de survol).
// Tap sur une rangée → popup de prévisualisation en grand (croix, épingle,
// téléchargement, corbeille avec confirmation).
const HistoryModal: React.FC<Props> = ({ open, onClose, userId, isEntitled }) => {
  const [items, setItems] = useState<HistItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [favIds, setFavIds] = useState<string[]>([]);
  const [limitMsg, setLimitMsg] = useState(false);
  const [preview, setPreview] = useState<HistItem | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Tri par date : false = plus récentes d'abord (défaut), true = plus anciennes d'abord.
  const [sortAsc, setSortAsc] = useState(false);

  useEffect(() => {
    if (!open || !userId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLimitMsg(false);
      setPreview(null);
      setConfirmDelete(false);
      try {
        // where(userId) + limit, sans orderBy → pas d'index composite requis ; tri client.
        const q = query(
          collection(customDb, 'generations_history'),
          where('userId', '==', userId),
          limit(60),
        );
        const [snap, favs] = await Promise.all([getDocs(q), loadAnnonceFavorites(userId)]);
        const list: HistItem[] = [];
        snap.forEach((d) => {
          const x = d.data() as any;
          const imageUrl = x.imageUrl || x.imageFinal || x.url;
          if (imageUrl) list.push({ id: d.id, imageUrl, timestamp: x.timestamp || x.createdAt });
        });
        list.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
        if (!cancelled) { setItems(list); setFavIds(favs); }
      } catch (e) {
        console.warn('[HISTORY] chargement échoué:', e);
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, userId]);

  if (!open) return null;

  const toggleFav = (id: string) => {
    if (!userId) return;
    const isFav = favIds.includes(id);
    if (!isFav && favIds.length >= MAX_ANNONCE_FAVORITES) {
      setLimitMsg(true);
      setTimeout(() => setLimitMsg(false), 2500);
      return;
    }
    const next = isFav ? favIds.filter((x) => x !== id) : [...favIds, id];
    setFavIds(next);          // optimiste
    saveAnnonceFavorites(userId, next);
  };

  const removeAnnonce = async (item: HistItem) => {
    if (!userId) return;
    try {
      await deleteDoc(doc(customDb, 'generations_history', item.id));
      setItems((prev) => prev.filter((x) => x.id !== item.id));
      if (favIds.includes(item.id)) {
        const next = favIds.filter((x) => x !== item.id);
        setFavIds(next);
        saveAnnonceFavorites(userId, next);
      }
    } catch (e) {
      console.warn('[HISTORY] suppression échouée:', e);
    }
  };

  // Favoris épinglés en tête (dans l'ordre où ils ont été ajoutés), puis le
  // reste par date selon le sens de tri choisi.
  const sorted = [...items].sort((a, b) => {
    const fa = favIds.indexOf(a.id);
    const fb = favIds.indexOf(b.id);
    if (fa !== -1 && fb !== -1) return fa - fb;
    if (fa !== -1) return -1;
    if (fb !== -1) return 1;
    const cmp = String(b.timestamp || '').localeCompare(String(a.timestamp || ''));
    return sortAsc ? -cmp : cmp;
  });

  const handleDownload = async (item: HistItem) => {
    setBusyId(item.id);
    try {
      const blob = isEntitled
        ? await fetchImageBlob(item.imageUrl)
        : await createWatermarkedBlob(item.imageUrl, GUEST_WATERMARK);
      if (blob) triggerDownload(blob, `${isEntitled ? 'visuel' : 'apercu'}-${item.id}.jpg`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[9995] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl border border-white/10 bg-zinc-900 text-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <h2 className="text-base font-bold">
            Mes annonces
            {favIds.length > 0 && (
              <span className="ml-2 text-xs font-normal text-amber-300/80">★ {favIds.length}/{MAX_ANNONCE_FAVORITES} épinglées</span>
            )}
          </h2>
          <button onClick={onClose} className="text-xl leading-none text-white/40 hover:text-white">×</button>
        </div>

        {limitMsg && (
          <div className="bg-amber-500/15 px-6 py-2.5 text-center text-sm font-medium text-amber-200">
            Maximum {MAX_ANNONCE_FAVORITES} annonces épinglées. Retirez-en une d'abord.
          </div>
        )}

        {/* Barre de tri — les épinglées restent toujours en tête. */}
        {items.length > 1 && (
          <div className="flex items-center justify-end border-b border-white/5 px-4 py-1.5">
            <button
              onClick={() => setSortAsc((v) => !v)}
              className="flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1 text-[9px] font-bold uppercase tracking-widest text-white/60 active:bg-white/15"
            >
              {sortAsc
                ? <ArrowUpNarrowWide size={12} strokeWidth={1.5} />
                : <ArrowDownWideNarrow size={12} strokeWidth={1.5} />}
              {sortAsc ? 'Plus anciennes d\'abord' : 'Plus récentes d\'abord'}
            </button>
          </div>
        )}

        <div className="min-h-[200px] flex-1 overflow-y-auto px-3 py-2">
          {loading && <p className="py-10 text-center text-sm text-white/40">Chargement…</p>}

          {!loading && items.length === 0 && (
            <div className="py-14 text-center">
              <Images size={28} strokeWidth={1.25} className="mx-auto mb-3 text-white/30" />
              <p className="text-sm text-white/60">Aucune création pour l'instant.</p>
              <p className="mt-1 text-xs text-white/40">Vos visuels générés apparaîtront ici.</p>
            </div>
          )}

          {/* Liste dense : une rangée fine par annonce, actions toujours visibles. */}
          {!loading && items.length > 0 && (
            <div className="divide-y divide-white/5">
              {sorted.map((item) => {
                const isFav = favIds.includes(item.id);
                return (
                  <div key={item.id} className="flex items-center gap-3 py-1.5">
                    <button
                      onClick={() => { setPreview(item); setConfirmDelete(false); }}
                      className={`shrink-0 overflow-hidden rounded border ${isFav ? 'border-amber-300/60' : 'border-white/10'}`}
                    >
                      <img
                        src={item.imageUrl}
                        alt="Annonce"
                        referrerPolicy="no-referrer"
                        loading="lazy"
                        className="h-[42px] w-[56px] object-cover"
                        draggable={isEntitled}
                        onDragStart={!isEntitled ? (e) => e.preventDefault() : undefined}
                        onContextMenu={!isEntitled ? (e) => e.preventDefault() : undefined}
                      />
                    </button>

                    <button
                      onClick={() => { setPreview(item); setConfirmDelete(false); }}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block truncate text-[11px] font-medium text-white/85">
                        {formatDate(item.timestamp)}
                      </span>
                      <span className="block text-[9px] uppercase tracking-widest text-white/35">
                        {isFav ? '★ Épinglée' : 'Annonce'}
                      </span>
                    </button>

                    <button
                      onClick={() => toggleFav(item.id)}
                      title={isFav ? 'Retirer des épingles' : 'Épingler en haut (max 5)'}
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${
                        isFav ? 'bg-amber-400/90 text-black' : 'bg-white/5 text-white/50 active:bg-white/15'
                      }`}
                    >
                      <Star size={14} strokeWidth={1.5} fill={isFav ? 'currentColor' : 'none'} />
                    </button>

                    <button
                      onClick={() => { setPreview(item); setConfirmDelete(true); }}
                      title="Supprimer"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/5 text-white/50 active:bg-red-500/80 active:text-white"
                    >
                      <Trash2 size={14} strokeWidth={1.5} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {!isEntitled && items.length > 0 && (
          <div className="border-t border-white/10 px-6 py-3 text-center text-[11px] text-white/45">
            Les téléchargements portent le filigrane « {GUEST_WATERMARK} ». Passez à une offre pour le HD sans filigrane.
          </div>
        )}
      </div>

      {/* Popup de prévisualisation en grand : croix, épingle, téléchargement,
          corbeille (avec confirmation). */}
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
              <span className="truncate text-[11px] font-bold uppercase tracking-[0.15em] text-white/80">
                {formatDate(preview.timestamp)}
              </span>
              <button
                onClick={() => { setPreview(null); setConfirmDelete(false); }}
                aria-label="Fermer"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-white/60 active:bg-white/20 active:text-white"
              >
                <X size={16} strokeWidth={1.5} />
              </button>
            </div>

            <img
              src={preview.imageUrl}
              alt="Annonce"
              referrerPolicy="no-referrer"
              className="aspect-[4/3] w-full object-cover"
              draggable={isEntitled}
              onDragStart={!isEntitled ? (e) => e.preventDefault() : undefined}
              onContextMenu={!isEntitled ? (e) => e.preventDefault() : undefined}
            />

            <div className="flex items-center justify-between gap-2 border-t border-white/10 px-4 py-3">
              {confirmDelete ? (
                <>
                  <span className="text-[11px] text-white/70">Supprimer cette annonce&nbsp;?</span>
                  <div className="flex gap-1.5">
                    <button
                      onClick={async () => { await removeAnnonce(preview); setConfirmDelete(false); setPreview(null); }}
                      className="rounded bg-red-500 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-white active:bg-red-400"
                    >
                      Supprimer
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
                  <button
                    onClick={() => toggleFav(preview.id)}
                    title={favIds.includes(preview.id) ? 'Retirer des épingles' : 'Épingler (max 5)'}
                    className={`flex h-9 w-9 items-center justify-center rounded-full border border-white/15 transition-colors ${
                      favIds.includes(preview.id) ? 'bg-amber-400/90 text-black' : 'bg-white/5 text-white/70 active:bg-white/15'
                    }`}
                  >
                    <Star size={15} strokeWidth={1.5} fill={favIds.includes(preview.id) ? 'currentColor' : 'none'} />
                  </button>
                  <button
                    onClick={() => handleDownload(preview)}
                    disabled={busyId === preview.id}
                    className="flex flex-1 items-center justify-center gap-2 rounded bg-white py-2 text-[10px] font-black uppercase tracking-[0.2em] text-black active:bg-white/80 disabled:opacity-50"
                  >
                    <Download size={13} strokeWidth={2} />
                    {busyId === preview.id ? '…' : 'Télécharger'}
                  </button>
                  <button
                    onClick={() => setConfirmDelete(true)}
                    title="Supprimer"
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

export default HistoryModal;
