import React from 'react';
import { Images, Wallpaper, Wand2, Palette, CreditCard, LogOut } from 'lucide-react';
import type { AuthUser } from '../lib/auth';

interface Props {
  open: boolean;
  onClose: () => void;
  user: AuthUser | null;
  plan: string | null;
  isEntitled: boolean;
  onOpenAnnonces: () => void;
  onOpenFavoris: () => void;
  onOpenCustom: () => void;
  onOpenBrandKit: () => void;
  onOpenAbonnement: () => void;
  onLogout: () => void;
}

// Pictos : lucide (monochromes, trait fin) — même esprit minimal que le reste de l'UI.
const Row: React.FC<{
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  right?: React.ReactNode;
  disabled?: boolean;
}> = ({ icon, label, onClick, right, disabled }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors ${
      disabled ? 'cursor-default opacity-40' : 'hover:bg-white/5'
    }`}
  >
    <span className="flex w-6 items-center justify-center text-white/60">{icon}</span>
    <span className="flex-1 text-sm font-medium text-white">{label}</span>
    {right ?? (!disabled && <span className="text-white/30">›</span>)}
  </button>
);

const MonEspacePanel: React.FC<Props> = ({
  open, onClose, user, plan, isEntitled,
  onOpenAnnonces, onOpenFavoris, onOpenCustom, onOpenBrandKit, onOpenAbonnement, onLogout,
}) => {
  const name = user?.displayName || user?.email || 'Mon compte';
  const initial = (name.trim()[0] || 'U').toUpperCase();

  return (
    <div
      className={`fixed inset-0 z-[9994] transition-opacity duration-200 ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      onClick={onClose}
    >
      {/* voile */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* panneau glissant depuis la droite */}
      <aside
        className={`absolute right-0 top-0 flex h-full w-[86%] max-w-[340px] flex-col bg-zinc-950 shadow-2xl transition-transform duration-300 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* En-tête */}
        <div className="flex items-center gap-3 border-b border-white/10 px-5 py-5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-lg font-bold text-white">
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">{name}</p>
            <span
              className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                isEntitled ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/10 text-white/50'
              }`}
            >
              {isEntitled ? `Abonné${plan && plan !== 'pro' ? ' · ' + plan : ' Pro'}` : 'Gratuit'}
            </span>
          </div>
          <button onClick={onClose} className="text-2xl leading-none text-white/40 hover:text-white">×</button>
        </div>

        {/* Entrées */}
        <nav className="flex-1 overflow-y-auto py-2">
          <Row icon={<Images size={18} strokeWidth={1.5} />} label="Mes annonces" onClick={onOpenAnnonces} />
          {/* « Mes fonds » : favoris du catalogue + fonds générés via CUSTOM */}
          <Row icon={<Wallpaper size={18} strokeWidth={1.5} />} label="Mes fonds" onClick={onOpenFavoris} />
          <Row
            icon={<Wand2 size={18} strokeWidth={1.5} />}
            label="Custom"
            onClick={onOpenCustom}
            right={<span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">Fond IA</span>}
          />
          <Row icon={<Palette size={18} strokeWidth={1.5} />} label="Brand Kit" onClick={onOpenBrandKit} />
          <Row
            icon={<CreditCard size={18} strokeWidth={1.5} />}
            label="Mon abonnement"
            onClick={onOpenAbonnement}
            right={!isEntitled ? <span className="rounded-full bg-emerald-600 px-2.5 py-0.5 text-[10px] font-bold text-white">Passer Pro</span> : <span className="text-white/30">›</span>}
          />
        </nav>

        {/* Pied : déconnexion */}
        <div className="border-t border-white/10 py-2">
          <Row icon={<LogOut size={18} strokeWidth={1.5} />} label="Se déconnecter" onClick={onLogout} right={<span />} />
        </div>
      </aside>
    </div>
  );
};

export default MonEspacePanel;
