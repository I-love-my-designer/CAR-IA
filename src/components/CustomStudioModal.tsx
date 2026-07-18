import React, { useEffect, useRef, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import {
  listCustomFolder, generateBackground, saveCustomBackground, listSavedCustomBackgrounds,
  deleteCustomBackground, MAX_SAVED_BACKGROUNDS, type CustomAsset,
} from '../lib/customStudio';
import { loadBrandKit } from './BrandKitModal';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Logo du Brand Kit, affiché par défaut et intégré au fond généré. */
  brandLogoUrl: string | null;
  userId: string | null;
  /** URL complète de l'endpoint moteur (résolue côté MainApp via resolveApiUrl). */
  apiUrl: string;
  /** Appelé quand un fond est enregistré → devient un environnement sélectionnable. */
  onSaved?: (url: string) => void;
}

type Step = 'pick' | 'customize' | 'result';
type Mode = 'color' | 'solfond';

// hsl → hex (le moteur attend un #rrggbb)
const hslToHex = (h: number, s: number, l: number): string => {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const c = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
};

const Thumb: React.FC<{ url: string; selected: boolean; onClick: () => void; label?: string }> = ({
  url, selected, onClick, label,
}) => (
  <button
    onClick={onClick}
    className={`relative aspect-square overflow-hidden transition-all ${
      selected ? 'ring-2 ring-inset ring-white' : 'ring-1 ring-inset ring-white/10 hover:ring-white/30'
    }`}
  >
    <img src={url} alt={label || ''} referrerPolicy="no-referrer" loading="lazy" className="h-full w-full object-cover opacity-90" />
    {label && (
      /* pr-7 : réserve la place de la corbeille en bas à droite (pas de chevauchement). */
      <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1 py-0.5 pr-7 text-[7.5px] uppercase tracking-[0.12em] text-white/80">
        {label}
      </span>
    )}
  </button>
);

const CustomStudioModal: React.FC<Props> = ({ open, onClose, brandLogoUrl, userId, apiUrl, onSaved }) => {
  const [step, setStep] = useState<Step>('pick');
  const [mode, setMode] = useState<Mode>('color');
  const [examples, setExamples] = useState<CustomAsset[]>([]);
  const [sols, setSols] = useState<CustomAsset[]>([]);
  const [fonds, setFonds] = useState<CustomAsset[]>([]);
  const [saved, setSaved] = useState<CustomAsset[]>([]);
  const [loading, setLoading] = useState(false);

  const [example, setExample] = useState<string | null>(null);
  const [color, setColor] = useState<string>('#38bdf8');
  const [sol, setSol] = useState<string | null>(null);
  const [fond, setFond] = useState<string | null>(null);
  const [material, setMaterial] = useState('');

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [savedUrl, setSavedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pickerRef = useRef<HTMLDivElement>(null);
  const [pickerPos, setPickerPos] = useState<{ x: number; y: number } | null>(null);

  // Popup de prévisualisation d'un fond enregistré (tap sur la vignette) :
  // grand aperçu + « Utiliser comme base » + corbeille + croix. Tactile-first.
  const [savedPreview, setSavedPreview] = useState<{ id: string; url: string; label: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Filet de sécurité : si aucun logo n'est fourni par la session (prop), on va
  // chercher celui du Brand Kit directement dans Firestore (brand_kits/{uid}).
  const [kitLogo, setKitLogo] = useState<string | null>(null);
  useEffect(() => {
    if (!open || brandLogoUrl || !userId) return;
    let cancelled = false;
    (async () => {
      const kit = await loadBrandKit(userId);
      if (!cancelled && kit?.logoUrl) setKitLogo(kit.logoUrl);
    })();
    return () => { cancelled = true; };
  }, [open, brandLogoUrl, userId]);
  const effectiveLogo = brandLogoUrl || kitLogo;

  useEffect(() => {
    if (!open) return;
    // reset léger à l'ouverture
    setStep('pick'); setError(null); setResult(null); setSavedUrl(null);
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [ex, so, fo, sv] = await Promise.all([
        listCustomFolder('EXAMPLES'), listCustomFolder('SOLS'), listCustomFolder('FONDS'),
        userId ? listSavedCustomBackgrounds(userId) : Promise.resolve([]),
      ]);
      if (!cancelled) { setExamples(ex); setSols(so); setFonds(fo); setSaved(sv); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [open]);

  if (!open) return null;

  const onPickColor = (e: React.PointerEvent) => {
    const el = pickerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const xf = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const yf = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    const hue = Math.round(xf * 360);
    let s: number, l: number;
    if (yf <= 0.5) { s = (yf / 0.5) * 100; l = 100 - (yf / 0.5) * 50; }
    else { s = 100; l = 50 - ((yf - 0.5) / 0.5) * 50; }
    setColor(hslToHex(hue, s, l));
    setPickerPos({ x: xf * r.width, y: yf * r.height });
  };

  const runGenerate = async () => {
    setError(null); setBusy(true); setResult(null); setSavedUrl(null);
    try {
      const params = mode === 'color'
        ? { baseImage: example, color, logo: effectiveLogo, logoMaterialPrompt: material || null }
        : { groundImage: sol, topImage: fond, baseImage: example, logo: effectiveLogo, logoMaterialPrompt: material || null };
      const img = await generateBackground(apiUrl, params);
      setResult(img);
      setStep('result');
    } catch (e: any) {
      setError(e?.message || 'Génération échouée.');
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    if (!result) return;
    const a = document.createElement('a');
    a.href = result;
    a.download = `fond-custom-${Date.now()}.jpg`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const save = async () => {
    if (!result || !userId) return;
    if (saved.length >= MAX_SAVED_BACKGROUNDS) {
      setError(`Limite de ${MAX_SAVED_BACKGROUNDS} fonds atteinte — supprimez-en un (étape « Choisir un fond ») pour enregistrer celui-ci.`);
      return;
    }
    setBusy(true); setError(null);
    try {
      const { id, url } = await saveCustomBackground(userId, result);
      setSavedUrl(url);
      // Le fond apparaît immédiatement en fin de liste « Mes fonds enregistrés »
      // (ordre chronologique : le plus récent porte le numéro le plus élevé).
      setSaved((prev) => [...prev, { name: id, url }]);
      onSaved?.(url);
    } catch (e: any) {
      setError(e?.message || 'Enregistrement échoué.');
    } finally {
      setBusy(false);
    }
  };

  // Suppression d'un fond enregistré (fiche Firestore + fichier Storage).
  const removeSaved = async (asset: CustomAsset) => {
    if (!userId) return;
    try {
      await deleteCustomBackground(userId, asset.name);
      setSaved((prev) => prev.filter((a) => a.name !== asset.name));
      if (example === asset.url) setExample(null);
    } catch (e: any) {
      setError(e?.message || 'Suppression échouée.');
    }
  };

  const canGenerate = mode === 'color'
    ? !!example
    : (!!sol && !!fond) || !!example;

  return (
    <div className="fixed inset-0 z-[9997] flex flex-col bg-zinc-950 text-white">
      {/* Barre supérieure — padding safe-area : en PWA plein écran iPhone, sans
          lui la croix passait sous l'encoche et devenait intouchable. */}
      <div
        className="flex items-center justify-between border-b border-white/10 px-5 pb-3"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' }}
      >
        <div className="flex items-center gap-3">
          <h2 className="text-base font-black uppercase tracking-[0.2em]">Custom</h2>
          <span className="text-[10px] uppercase tracking-widest text-white/40">
            {step === 'pick' ? 'Choisir un fond' : step === 'customize' ? 'Personnaliser' : 'Résultat'}
          </span>
        </div>
        <button
          onClick={onClose}
          aria-label="Fermer"
          className="flex h-10 w-10 shrink-0 items-center justify-center border border-white/15 bg-white/5 text-xl leading-none text-white/70 transition-colors hover:bg-white/15 hover:text-white"
        >
          ×
        </button>
      </div>

      {/* Logo Brand Kit par défaut */}
      <div className="flex items-center gap-3 border-b border-white/5 bg-black/30 px-5 py-2.5">
        <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded bg-[#808080]">
          {effectiveLogo
            ? <img src={effectiveLogo} alt="logo" referrerPolicy="no-referrer" className="max-h-[85%] max-w-[85%] object-contain" />
            : <span className="text-[7px] uppercase tracking-widest text-white/40">Logo</span>}
        </div>
        <span className="text-[10px] uppercase tracking-widest text-white/50">
          {effectiveLogo ? 'Logo du Brand Kit — intégré au fond généré' : 'Aucun logo — ajoutez-en un dans le Brand Kit'}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {loading && <p className="py-10 text-center text-sm text-white/40">Chargement…</p>}

        {/* ÉTAPE 1 : choix d'un fond d'exemple */}
        {!loading && step === 'pick' && (
          <>
            {/* Fonds custom déjà générés/enregistrés par l'utilisateur : nommés
                « Fond 1 » → « Fond 10 » (ordre de création, max 10), supprimables
                via la corbeille, et réutilisables comme base d'une nouvelle passe. */}
            {saved.length > 0 && (
              <div className="mb-5">
                <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-emerald-300/80">
                  Mes fonds enregistrés ({saved.length}/{MAX_SAVED_BACKGROUNDS})
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {saved.map((a, i) => (
                    <div key={a.url} className="relative">
                      <Thumb
                        url={a.url}
                        selected={example === a.url}
                        onClick={() => { setSavedPreview({ id: a.name, url: a.url, label: `Fond ${i + 1}` }); setConfirmDelete(false); }}
                        label={`Fond ${i + 1}`}
                      />
                      <button
                        onClick={(e) => { e.stopPropagation(); setSavedPreview({ id: a.name, url: a.url, label: `Fond ${i + 1}` }); setConfirmDelete(true); }}
                        aria-label={`Supprimer Fond ${i + 1}`}
                        className="absolute bottom-1 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white/60 active:bg-red-500/80 active:text-white"
                      >
                        <Trash2 size={11} strokeWidth={1.5} />
                      </button>
                    </div>
                  ))}
                </div>
                <p className="mt-3 mb-1.5 text-[10px] font-bold uppercase tracking-widest text-white/60">
                  Fonds d'exemple
                </p>
              </div>
            )}
            {examples.length === 0 ? (
              <div className="py-14 text-center">
                <div className="mb-3 text-3xl">🖼️</div>
                <p className="text-sm text-white/60">Aucun fond d'exemple.</p>
                <p className="mx-auto mt-1 max-w-xs text-xs text-white/40">
                  Déposez des images dans <span className="font-mono text-white/60">ENVIRONMENTS/CUSTOM/EXAMPLES/</span> (Firebase Storage).
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {examples.map((a) => (
                  <Thumb key={a.url} url={a.url} selected={example === a.url} onClick={() => setExample(a.url)} label={a.name.replace(/\.[a-z]+$/i, '')} />
                ))}
              </div>
            )}
          </>
        )}

        {/* ÉTAPE 2 : personnalisation */}
        {!loading && step === 'customize' && (
          <div className="space-y-5">
            {/* Aperçu du haut : en mode SOL + FOND, les vignettes cliquées
                apparaissent immédiatement (fond = moitié haute, sol = moitié
                basse — en attendant les masques/couches alpha cumulables). */}
            {mode === 'solfond' && (sol || fond) ? (
              <div className="flex aspect-video w-full flex-col overflow-hidden rounded">
                <div className="h-1/2 w-full bg-zinc-800/60">
                  {fond
                    ? <img src={fond} alt="Fond sélectionné" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                    : <div className="flex h-full items-center justify-center text-[9px] uppercase tracking-widest text-white/25">Fond ?</div>}
                </div>
                <div className="h-1/2 w-full bg-zinc-800/60">
                  {sol
                    ? <img src={sol} alt="Sol sélectionné" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                    : <div className="flex h-full items-center justify-center text-[9px] uppercase tracking-widest text-white/25">Sol ?</div>}
                </div>
              </div>
            ) : example && (
              <img src={example} alt="" referrerPolicy="no-referrer" className="aspect-video w-full rounded object-cover" />
            )}

            {/* Choix du mode */}
            <div className="grid grid-cols-2 gap-1">
              {(['color', 'solfond'] as Mode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`h-9 text-[10px] font-bold uppercase tracking-widest transition-all ${
                    mode === m ? 'bg-white text-black' : 'bg-white/5 text-white/50 border border-white/10'
                  }`}
                >
                  {m === 'color' ? 'Couleur' : 'Sol + Fond'}
                </button>
              ))}
            </div>

            {mode === 'color' && (
              <div className="flex gap-4">
                <div
                  ref={pickerRef}
                  onPointerDown={onPickColor}
                  onPointerMove={(e) => e.buttons === 1 && onPickColor(e)}
                  className="relative h-24 flex-1 cursor-crosshair touch-none overflow-hidden"
                  style={{
                    background:
                      'linear-gradient(to bottom, white, transparent 50%, black), linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)',
                  }}
                >
                  {pickerPos && (
                    <div className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md" style={{ left: pickerPos.x, top: pickerPos.y }} />
                  )}
                </div>
                <div className="h-24 w-16 shrink-0" style={{ backgroundColor: color }} />
              </div>
            )}

            {mode === 'solfond' && (
              <div className="space-y-4">
                <div>
                  <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-white/60">Sol</p>
                  {sols.length === 0 ? (
                    <p className="text-xs text-white/40">Déposez des sols dans <span className="font-mono">ENVIRONMENTS/CUSTOM/SOLS/</span>.</p>
                  ) : (
                    <div className="grid grid-cols-4 gap-1.5">
                      {sols.map((a) => <Thumb key={a.url} url={a.url} selected={sol === a.url} onClick={() => setSol(a.url)} />)}
                    </div>
                  )}
                </div>
                <div>
                  <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-white/60">Fond (partie haute)</p>
                  {fonds.length === 0 ? (
                    <p className="text-xs text-white/40">Déposez des fonds dans <span className="font-mono">ENVIRONMENTS/CUSTOM/FONDS/</span>.</p>
                  ) : (
                    <div className="grid grid-cols-4 gap-1.5">
                      {fonds.map((a) => <Thumb key={a.url} url={a.url} selected={fond === a.url} onClick={() => setFond(a.url)} />)}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Matériau du logo (optionnel) */}
            {effectiveLogo && (
              <div>
                <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-white/60">Matériau du logo (optionnel)</p>
                <input
                  value={material}
                  onChange={(e) => setMaterial(e.target.value)}
                  placeholder="ex. gravé sur un mur en béton, enseigne rétroéclairée…"
                  className="w-full border border-white/10 bg-black/40 px-3 py-2 text-xs text-white placeholder-white/25 outline-none focus:border-white/30"
                />
              </div>
            )}

            {error && <p className="text-center text-xs text-red-400">{error}</p>}
          </div>
        )}

        {/* ÉTAPE 3 : résultat */}
        {!loading && step === 'result' && result && (
          <div className="space-y-4">
            <img src={result} alt="Fond généré" className="w-full rounded" />
            {savedUrl && <p className="text-center text-xs text-emerald-300">✓ Fond enregistré — retrouvez-le dans « Mes fonds enregistrés » (étape 1, Choisir un fond).</p>}
            {error && <p className="text-center text-xs text-red-400">{error}</p>}
          </div>
        )}
      </div>

      {/* Barre d'actions */}
      <div className="flex gap-2 border-t border-white/10 p-4">
        {step === 'pick' && (
          <button
            onClick={() => setStep('customize')}
            disabled={!example}
            className="flex-1 bg-white py-3 text-[11px] font-black uppercase tracking-[0.2em] text-black disabled:opacity-30"
          >
            Customize
          </button>
        )}
        {step === 'customize' && (
          <>
            <button onClick={() => setStep('pick')} className="border border-white/15 px-5 text-[11px] font-bold uppercase tracking-widest text-white/70">Retour</button>
            <button
              onClick={runGenerate}
              disabled={!canGenerate || busy}
              className="flex-1 bg-emerald-500 py-3 text-[11px] font-black uppercase tracking-[0.2em] text-black disabled:opacity-30"
            >
              {busy ? 'Génération…' : 'Générer fond'}
            </button>
          </>
        )}
        {step === 'result' && (
          <>
            <button onClick={() => setStep('customize')} className="border border-white/15 px-4 text-[11px] font-bold uppercase tracking-widest text-white/70">Recommencer</button>
            <button onClick={download} className="border border-white/15 px-4 text-[11px] font-bold uppercase tracking-widest text-white/70">Télécharger</button>
            <button
              onClick={save}
              disabled={busy || !!savedUrl || !userId}
              className="flex-1 bg-white py-3 text-[11px] font-black uppercase tracking-[0.2em] text-black disabled:opacity-40"
            >
              {savedUrl ? 'Enregistré ✓' : busy ? '…' : 'Enregistrer'}
            </button>
          </>
        )}
      </div>

      {/* Popup de prévisualisation d'un fond enregistré : grand aperçu, croix,
          « Utiliser comme base » et corbeille (avec confirmation). */}
      {savedPreview && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm"
          onClick={() => { setSavedPreview(null); setConfirmDelete(false); }}
        >
          <div
            className="w-full max-w-lg overflow-hidden border border-white/15 bg-zinc-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
              <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-white/80">{savedPreview.label}</span>
              <button
                onClick={() => { setSavedPreview(null); setConfirmDelete(false); }}
                aria-label="Fermer"
                className="flex h-8 w-8 items-center justify-center bg-white/5 text-white/60 active:bg-white/20 active:text-white"
              >
                <X size={16} strokeWidth={1.5} />
              </button>
            </div>

            <img src={savedPreview.url} alt={savedPreview.label} referrerPolicy="no-referrer" className="aspect-square w-full object-cover" />

            <div className="flex items-center justify-between gap-2 border-t border-white/10 px-4 py-3">
              {confirmDelete ? (
                <>
                  <span className="text-[11px] text-white/70">Supprimer ce fond&nbsp;?</span>
                  <div className="flex gap-1.5">
                    <button
                      onClick={async () => {
                        const target = saved.find((s) => s.name === savedPreview.id);
                        if (target) await removeSaved(target);
                        setConfirmDelete(false);
                        setSavedPreview(null);
                      }}
                      className="bg-red-500 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-white active:bg-red-400"
                    >
                      Supprimer
                    </button>
                    <button
                      onClick={() => setConfirmDelete(false)}
                      className="bg-white/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-white/70 active:bg-white/20"
                    >
                      Annuler
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <button
                    onClick={() => { setExample(savedPreview.url); setSavedPreview(null); }}
                    className="flex-1 bg-white py-2 text-[10px] font-black uppercase tracking-[0.2em] text-black active:bg-white/80"
                  >
                    Utiliser comme base
                  </button>
                  <button
                    onClick={() => setConfirmDelete(true)}
                    title="Supprimer"
                    className="flex h-9 w-9 shrink-0 items-center justify-center border border-white/15 bg-white/5 text-white/70 active:bg-red-500/80 active:text-white"
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

export default CustomStudioModal;
