import React, { useEffect, useRef, useState } from 'react';
import {
  listCustomFolder, generateBackground, saveCustomBackground, type CustomAsset,
} from '../lib/customStudio';

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
      <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1 py-0.5 text-[8px] uppercase tracking-widest text-white/80">
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

  useEffect(() => {
    if (!open) return;
    // reset léger à l'ouverture
    setStep('pick'); setError(null); setResult(null); setSavedUrl(null);
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [ex, so, fo] = await Promise.all([
        listCustomFolder('EXAMPLES'), listCustomFolder('SOLS'), listCustomFolder('FONDS'),
      ]);
      if (!cancelled) { setExamples(ex); setSols(so); setFonds(fo); setLoading(false); }
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
        ? { baseImage: example, color, logo: brandLogoUrl, logoMaterialPrompt: material || null }
        : { groundImage: sol, topImage: fond, baseImage: example, logo: brandLogoUrl, logoMaterialPrompt: material || null };
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
    setBusy(true); setError(null);
    try {
      const { url } = await saveCustomBackground(userId, result);
      setSavedUrl(url);
      onSaved?.(url);
    } catch (e: any) {
      setError(e?.message || 'Enregistrement échoué.');
    } finally {
      setBusy(false);
    }
  };

  const canGenerate = mode === 'color'
    ? !!example
    : (!!sol && !!fond) || !!example;

  return (
    <div className="fixed inset-0 z-[9997] flex flex-col bg-zinc-950 text-white">
      {/* Barre supérieure */}
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-black uppercase tracking-[0.2em]">Custom</h2>
          <span className="text-[10px] uppercase tracking-widest text-white/40">
            {step === 'pick' ? 'Choisir un fond' : step === 'customize' ? 'Personnaliser' : 'Résultat'}
          </span>
        </div>
        <button onClick={onClose} className="text-2xl leading-none text-white/40 hover:text-white">×</button>
      </div>

      {/* Logo Brand Kit par défaut */}
      <div className="flex items-center gap-3 border-b border-white/5 bg-black/30 px-5 py-2.5">
        <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded bg-[#808080]">
          {brandLogoUrl
            ? <img src={brandLogoUrl} alt="logo" referrerPolicy="no-referrer" className="max-h-[85%] max-w-[85%] object-contain" />
            : <span className="text-[7px] uppercase tracking-widest text-white/40">Logo</span>}
        </div>
        <span className="text-[10px] uppercase tracking-widest text-white/50">
          {brandLogoUrl ? 'Logo du Brand Kit — intégré au fond généré' : 'Aucun logo — ajoutez-en un dans le Brand Kit'}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {loading && <p className="py-10 text-center text-sm text-white/40">Chargement…</p>}

        {/* ÉTAPE 1 : choix d'un fond d'exemple */}
        {!loading && step === 'pick' && (
          <>
            {examples.length === 0 ? (
              <div className="py-14 text-center">
                <div className="mb-3 text-3xl">🖼️</div>
                <p className="text-sm text-white/60">Aucun fond d'exemple.</p>
                <p className="mx-auto mt-1 max-w-xs text-xs text-white/40">
                  Déposez des images dans <span className="font-mono text-white/60">CUSTOM/EXAMPLES/</span> (Firebase Storage).
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
            {example && (
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
                    <p className="text-xs text-white/40">Déposez des sols dans <span className="font-mono">CUSTOM/SOLS/</span>.</p>
                  ) : (
                    <div className="grid grid-cols-4 gap-1.5">
                      {sols.map((a) => <Thumb key={a.url} url={a.url} selected={sol === a.url} onClick={() => setSol(a.url)} />)}
                    </div>
                  )}
                </div>
                <div>
                  <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-white/60">Fond (partie haute)</p>
                  {fonds.length === 0 ? (
                    <p className="text-xs text-white/40">Déposez des fonds dans <span className="font-mono">CUSTOM/FONDS/</span>.</p>
                  ) : (
                    <div className="grid grid-cols-4 gap-1.5">
                      {fonds.map((a) => <Thumb key={a.url} url={a.url} selected={fond === a.url} onClick={() => setFond(a.url)} />)}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Matériau du logo (optionnel) */}
            {brandLogoUrl && (
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
            {savedUrl && <p className="text-center text-xs text-emerald-300">✓ Fond enregistré — disponible comme environnement.</p>}
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
    </div>
  );
};

export default CustomStudioModal;
