import React, { useEffect, useState } from 'react';
import { collection, query, where, limit, getDocs } from 'firebase/firestore';
import { customDb } from '../lib/firebase';
import { createWatermarkedBlob, fetchImageBlob, GUEST_WATERMARK } from '../lib/watermark';

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

const HistoryModal: React.FC<Props> = ({ open, onClose, userId, isEntitled }) => {
  const [items, setItems] = useState<HistItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !userId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // where(userId) + limit, sans orderBy → pas d'index composite requis ; tri client.
        const q = query(
          collection(customDb, 'generations_history'),
          where('userId', '==', userId),
          limit(60),
        );
        const snap = await getDocs(q);
        const list: HistItem[] = [];
        snap.forEach((d) => {
          const x = d.data() as any;
          const imageUrl = x.imageUrl || x.imageFinal || x.url;
          if (imageUrl) list.push({ id: d.id, imageUrl, timestamp: x.timestamp || x.createdAt });
        });
        list.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
        if (!cancelled) setItems(list);
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
          <h2 className="text-base font-bold">Mes créations</h2>
          <button onClick={onClose} className="text-xl leading-none text-white/40 hover:text-white">×</button>
        </div>

        <div className="min-h-[200px] flex-1 overflow-y-auto p-6">
          {loading && <p className="py-10 text-center text-sm text-white/40">Chargement…</p>}

          {!loading && items.length === 0 && (
            <div className="py-14 text-center">
              <div className="mb-3 text-3xl">🖼️</div>
              <p className="text-sm text-white/60">Aucune création pour l'instant.</p>
              <p className="mt-1 text-xs text-white/40">Vos visuels générés apparaîtront ici.</p>
            </div>
          )}

          {!loading && items.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {items.map((item) => (
                <div key={item.id} className="group relative overflow-hidden rounded-lg border border-white/10 bg-black">
                  <img
                    src={item.imageUrl}
                    alt="Création"
                    referrerPolicy="no-referrer"
                    loading="lazy"
                    className="aspect-[4/3] w-full object-cover"
                    draggable={isEntitled}
                    onDragStart={!isEntitled ? (e) => e.preventDefault() : undefined}
                    onContextMenu={!isEntitled ? (e) => e.preventDefault() : undefined}
                  />
                  <button
                    onClick={() => handleDownload(item)}
                    disabled={busyId === item.id}
                    className="absolute inset-x-0 bottom-0 bg-black/70 py-2 text-[10px] font-bold uppercase tracking-widest opacity-0 transition-opacity hover:bg-black/85 group-hover:opacity-100 disabled:opacity-60"
                  >
                    {busyId === item.id ? '…' : 'Télécharger'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {!isEntitled && items.length > 0 && (
          <div className="border-t border-white/10 px-6 py-3 text-center text-[11px] text-white/45">
            Les téléchargements portent le filigrane « {GUEST_WATERMARK} ». Passez à une offre pour le HD sans filigrane.
          </div>
        )}
      </div>
    </div>
  );
};

export default HistoryModal;
