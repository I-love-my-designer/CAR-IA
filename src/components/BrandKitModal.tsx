import React, { useEffect, useRef, useState } from 'react';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadString, getDownloadURL } from 'firebase/storage';
import { customDb, storage } from '../lib/firebase';

export interface BrandKit {
  logoUrl: string | null;
  brandColor: string;
  slogan: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  userId: string | null;
  /** Applique le kit à la session courante (préremplit logo/couleur/slogan). */
  onApply: (kit: BrandKit) => void;
}

const EMPTY: BrandKit = { logoUrl: null, brandColor: '#ffffff', slogan: '' };

/** Lecture seule du Brand Kit d'un utilisateur (réutilisée par le préremplissage auto). */
export async function loadBrandKit(userId: string): Promise<BrandKit | null> {
  try {
    const snap = await getDoc(doc(customDb, 'brand_kits', userId));
    if (!snap.exists()) return null;
    const d = snap.data() as any;
    return {
      logoUrl: d.logoUrl ?? null,
      brandColor: d.brandColor || '#ffffff',
      slogan: d.slogan || '',
    };
  } catch (e) {
    console.warn('[BRANDKIT] lecture échouée:', e);
    return null;
  }
}

const BrandKitModal: React.FC<Props> = ({ open, onClose, userId, onApply }) => {
  const [kit, setKit] = useState<BrandKit>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || !userId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const existing = await loadBrandKit(userId);
      if (!cancelled) setKit(existing || EMPTY);
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, userId]);

  if (!open) return null;

  const handleLogoFile = async (file: File) => {
    if (!userId) return;
    setUploading(true);
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      const storageRef = ref(storage, `users/${userId}/brandkit/logo_${Date.now()}.png`);
      await uploadString(storageRef, dataUrl, 'data_url');
      const url = await getDownloadURL(storageRef);
      setKit((k) => ({ ...k, logoUrl: url }));
    } catch (e) {
      console.warn('[BRANDKIT] upload logo échoué:', e);
    } finally {
      setUploading(false);
    }
  };

  const persist = async (): Promise<boolean> => {
    if (!userId) return false;
    setSaving(true);
    try {
      await setDoc(
        doc(customDb, 'brand_kits', userId),
        { logoUrl: kit.logoUrl, brandColor: kit.brandColor, slogan: kit.slogan, updatedAt: serverTimestamp() },
        { merge: true },
      );
      return true;
    } catch (e) {
      console.warn('[BRANDKIT] enregistrement échoué:', e);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => { if (await persist()) onClose(); };
  const handleSaveApply = async () => { if (await persist()) { onApply(kit); onClose(); } };

  return (
    <div
      className="fixed inset-0 z-[9995] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-900 text-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <h2 className="text-base font-bold">Mon Brand Kit</h2>
          <button onClick={onClose} className="text-xl leading-none text-white/40 hover:text-white">×</button>
        </div>

        {loading ? (
          <p className="py-12 text-center text-sm text-white/40">Chargement…</p>
        ) : (
          <div className="space-y-5 p-6">
            <p className="text-xs text-white/50">
              Enregistrez votre logo, votre couleur et votre slogan une fois — ils seront
              proposés automatiquement à chaque nouvelle création.
            </p>

            {/* Logo */}
            <div>
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-white/70">Logo</label>
              <div className="flex items-center gap-3">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-white/5">
                  {kit.logoUrl
                    ? <img src={kit.logoUrl} alt="logo" className="max-h-full max-w-full object-contain" referrerPolicy="no-referrer" />
                    : <span className="text-[9px] text-white/30">Aucun</span>}
                </div>
                <div className="flex flex-col gap-1.5">
                  <button
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                    className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium hover:bg-white/20 disabled:opacity-60"
                  >
                    {uploading ? 'Envoi…' : (kit.logoUrl ? 'Changer le logo' : 'Ajouter un logo')}
                  </button>
                  {kit.logoUrl && (
                    <button onClick={() => setKit((k) => ({ ...k, logoUrl: null }))} className="text-left text-[11px] text-white/40 hover:text-white">
                      Retirer
                    </button>
                  )}
                </div>
                <input
                  ref={fileRef} type="file" accept="image/*" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleLogoFile(f); e.currentTarget.value = ''; }}
                />
              </div>
            </div>

            {/* Couleur de marque */}
            <div>
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-white/70">Couleur de marque</label>
              <div className="flex items-center gap-3">
                <input
                  type="color" value={kit.brandColor}
                  onChange={(e) => setKit((k) => ({ ...k, brandColor: e.target.value }))}
                  className="h-10 w-14 cursor-pointer rounded border border-white/10 bg-transparent"
                />
                <span className="font-mono text-xs text-white/60">{kit.brandColor}</span>
              </div>
            </div>

            {/* Slogan */}
            <div>
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-white/70">Slogan / texte</label>
              <input
                type="text" value={kit.slogan} maxLength={120}
                placeholder="Ex. Garage Dupont — Votre confiance depuis 1998"
                onChange={(e) => setKit((k) => ({ ...k, slogan: e.target.value }))}
                className="w-full rounded-lg border border-white/10 bg-zinc-800 px-3 py-2 text-sm outline-none focus:border-emerald-500"
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={handleSave} disabled={saving || uploading}
                className="flex-1 rounded-lg border border-white/15 bg-white/5 py-2.5 text-sm font-medium hover:bg-white/10 disabled:opacity-60"
              >
                {saving ? '…' : 'Enregistrer'}
              </button>
              <button
                onClick={handleSaveApply} disabled={saving || uploading}
                className="flex-1 rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold hover:bg-emerald-500 disabled:opacity-60"
              >
                Enregistrer & appliquer
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default BrandKitModal;
