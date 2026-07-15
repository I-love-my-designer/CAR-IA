import React, { useEffect, useRef, useState } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Reçoit la photo capturée sous forme de File (JPEG). */
  onCapture: (file: File) => void;
  /** Silhouette adaptée au type de véhicule. */
  vehicleKind?: 'car' | 'bike' | 'utility' | null;
}

// Silhouettes de profil (stroke) — simples mais reconnaissables — servant de gabarit
// d'alignement. viewBox commun 0 0 240 100.
const SILHOUETTES: Record<string, string> = {
  car: 'M8 66 C8 58 14 56 22 55 L44 54 C52 40 66 34 84 34 L150 34 C170 34 182 42 192 54 L224 58 C232 59 236 62 236 68 L236 72',
  utility: 'M8 66 C8 58 12 56 20 55 L40 54 C46 42 58 36 74 36 L150 36 L150 20 L214 20 C224 20 230 26 230 38 L232 58 C236 59 236 62 236 68 L236 72 L8 72',
  bike: 'M40 74 C40 74 60 40 92 40 L120 40 L150 56 L188 56 C200 56 206 62 206 74',
};

const CaptureModal: React.FC<Props> = ({ open, onClose, onCapture, vehicleKind }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [isPortrait, setIsPortrait] = useState(false);

  useEffect(() => {
    if (!open) return;
    const check = () => setIsPortrait(window.innerHeight > window.innerWidth);
    check();
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);
    return () => {
      window.removeEventListener('resize', check);
      window.removeEventListener('orientationchange', check);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    setReady(false);
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setReady(true);
      } catch (e: any) {
        setError(
          e?.name === 'NotAllowedError'
            ? "Accès à la caméra refusé. Autorisez la caméra pour ce site dans les réglages du navigateur."
            : "Impossible d'ouvrir la caméra sur cet appareil.",
        );
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [open]);

  if (!open) return null;

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `capture-${Date.now()}.jpg`, { type: 'image/jpeg' });
        onCapture(file);
        onClose();
      },
      'image/jpeg',
      0.92,
    );
  };

  const silhouette = SILHOUETTES[vehicleKind || 'car'] || SILHOUETTES.car;

  return (
    <div className="fixed inset-0 z-[9997] bg-black">
      {/* Flux caméra */}
      <video ref={videoRef} playsInline muted className="absolute inset-0 h-full w-full object-cover" />

      {/* Voile + gabarit */}
      <div className="pointer-events-none absolute inset-0">
        {/* Consigne */}
        <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/70 to-transparent px-5 pb-8 pt-5 text-center">
          <p className="text-sm font-bold uppercase tracking-widest text-white">Placez le véhicule dans le gabarit</p>
          <p className="mt-1 text-[11px] leading-snug text-white/70">
            📱 Téléphone à l'<strong className="text-white">horizontale</strong> · vue <strong className="text-white">3/4 avant</strong> · à <strong className="text-white">hauteur de taille</strong> · horizon droit · le véhicule doit <strong className="text-white">remplir</strong> le cadre.
          </p>
        </div>

        {/* Rappel de rotation si le téléphone est en portrait */}
        {isPortrait && (
          <div className="absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-black/75 px-5 py-4 text-center backdrop-blur">
            <div className="mb-1 text-3xl">🔄📱</div>
            <p className="text-sm font-bold text-white">Tournez le téléphone à l'horizontale</p>
            <p className="mt-0.5 text-[11px] text-white/60">Format paysage pour cadrer le véhicule</p>
          </div>
        )}

        {/* Coins de cadrage + silhouette */}
        <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid meet" viewBox="0 0 100 100">
          {/* coins */}
          {[
            'M6 14 V6 H14', 'M86 6 H94 V14', 'M94 86 V94 H86', 'M14 94 H6 V86',
          ].map((d, i) => (
            <path key={i} d={d} fill="none" stroke="white" strokeOpacity="0.85" strokeWidth="0.8" strokeLinecap="round" />
          ))}
          {/* ligne d'horizon (niveau) */}
          <line x1="10" y1="50" x2="90" y2="50" stroke="white" strokeOpacity="0.25" strokeWidth="0.4" strokeDasharray="2 2" />
        </svg>

        {/* Silhouette du véhicule, centrée */}
        <svg
          className="absolute left-1/2 top-1/2 w-[78%] -translate-x-1/2 -translate-y-1/2"
          viewBox="0 0 240 100"
          fill="none"
        >
          <path d={silhouette} stroke="white" strokeOpacity="0.9" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="7 5" />
          {vehicleKind !== 'utility' && (
            <>
              <circle cx="64" cy="74" r="17" stroke="white" strokeOpacity="0.9" strokeWidth="2.5" strokeDasharray="7 5" />
              <circle cx={vehicleKind === 'bike' ? 188 : 190} cy="74" r="17" stroke="white" strokeOpacity="0.9" strokeWidth="2.5" strokeDasharray="7 5" />
            </>
          )}
        </svg>
      </div>

      {/* Erreur */}
      {error && (
        <div className="absolute inset-x-6 top-1/2 -translate-y-1/2 rounded-xl bg-red-950/90 p-4 text-center text-sm text-red-200">
          {error}
        </div>
      )}

      {/* Barre d'actions */}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-8 pb-10 pt-6">
        <button onClick={onClose} className="text-sm font-medium text-white/80 hover:text-white">Annuler</button>
        <button
          onClick={capture}
          disabled={!ready || !!error}
          className="flex h-18 w-18 items-center justify-center rounded-full border-4 border-white bg-white/20 backdrop-blur transition-transform active:scale-95 disabled:opacity-40"
          style={{ height: 72, width: 72 }}
          aria-label="Prendre la photo"
        >
          <span className="block h-14 w-14 rounded-full bg-white" style={{ height: 56, width: 56 }} />
        </button>
        <span className="w-12" />
      </div>
    </div>
  );
};

export default CaptureModal;
