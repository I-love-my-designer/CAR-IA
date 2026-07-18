import React from 'react';
import { Delete, Check } from 'lucide-react';

/**
 * Clavier virtuel intégré (AZERTY majuscules + chiffres).
 *
 * Pourquoi : sur iOS, le clavier natif POUSSE toute la PWA vers le haut et fait
 * sortir l'interface du cadre (menu de logos hors écran dans « Branding »).
 * Les champs qui l'utilisent sont `readOnly` + `inputMode="none"` → le clavier
 * Apple ne s'ouvre jamais, l'app ne bouge pas d'un pixel.
 *
 * Style : même esprit minimal que le reste de l'UI (rounded-none, monochrome).
 */
interface Props {
  open: boolean;
  /** Petit libellé au-dessus du clavier (ex. la valeur en cours de saisie). */
  label?: string;
  /** false = pas de rangée de chiffres (ex. recherche constructeur) → la place
      gagnée sert à AGRANDIR les touches (meilleure zone tactile). */
  showDigits?: boolean;
  onKey: (char: string) => void;
  onBackspace: () => void;
  onDone: () => void;
}

const DIGIT_ROW = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
const LETTER_ROWS: string[][] = [
  ['A', 'Z', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['Q', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'M'],
  // Dernière rangée : lettres seules — les touches ⌫ et ✓ la complètent
  // (voir le rendu), les symboles - & . ' ont été retirés.
  ['W', 'X', 'C', 'V', 'B', 'N'],
];

const VirtualKeyboard: React.FC<Props> = ({ open, label, showDigits = true, onKey, onBackspace, onDone }) => {
  if (!open) return null;

  const rows = showDigits ? [DIGIT_ROW, ...LETTER_ROWS] : LETTER_ROWS;
  // Plus de barre ESPACE dédiée : la place gagnée agrandit toutes les touches.
  // Recherche (3 rangées) : 56px de haut ; texte (4 rangées) : 44px.
  const keyH = showDigits ? 'h-11' : 'h-14';
  const keyCls =
    `flex-1 ${keyH} flex items-center justify-center bg-white/5 border border-white/10 ` +
    'text-white text-[12px] font-bold select-none active:bg-white active:text-black transition-colors';

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[9998] border-t border-white/15 bg-zinc-950/98 px-1.5 pt-1.5"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.375rem)' }}
      // Empêche la perte de focus / la fermeture pendant qu'on tape.
      onMouseDown={(e) => e.preventDefault()}
    >
      {label !== undefined && (
        <div className="mb-1 px-1 truncate text-center font-mono text-[10px] tracking-[0.15em] text-white/60 uppercase">
          {label || '…'}
        </div>
      )}
      <div className="space-y-1">
        {rows.map((row, i) => (
          <div key={i} className="flex gap-1">
            {row.map((k) => (
              <button key={k} type="button" onClick={() => onKey(k)} className={keyCls}>
                {k}
              </button>
            ))}
            {/* Dernière rangée : (␣ en mode texte — les slogans multi-mots en
                ont besoin), puis ⌫ et ✓. Plus de barre ESPACE dédiée. */}
            {i === rows.length - 1 && (
              <>
                {showDigits && (
                  <button type="button" onClick={() => onKey(' ')} aria-label="Espace" className={`${keyCls} flex-[1.5] text-[10px]`}>
                    ␣
                  </button>
                )}
                <button type="button" onClick={onBackspace} aria-label="Effacer" className={`${keyCls} flex-[2]`}>
                  <Delete size={15} strokeWidth={1.5} />
                </button>
                <button
                  type="button"
                  onClick={onDone}
                  aria-label="Valider"
                  className={`flex ${keyH} flex-[2] items-center justify-center border border-white bg-white text-black active:bg-white/80`}
                >
                  <Check size={15} strokeWidth={2.5} />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default VirtualKeyboard;
