import React, { useState } from 'react';
import {
  signInWithGoogle,
  signInWithEmail,
  signUpWithEmail,
  authErrorMessage,
  type AuthUser,
} from '../lib/auth';

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: (user: AuthUser) => void;
  /** Optional line explaining why the account is needed (e.g. "pour télécharger votre visuel"). */
  reason?: string;
}

const AuthModal: React.FC<AuthModalProps> = ({ open, onClose, onSuccess, reason }) => {
  const [mode, setMode] = useState<'signin' | 'signup'>('signup');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const done = (user: AuthUser) => {
    setLoading(false);
    onSuccess?.(user);
    onClose();
  };

  const handleGoogle = async () => {
    setError(null); setLoading(true);
    try { done(await signInWithGoogle()); }
    catch (e: any) { setError(authErrorMessage(e?.code)); setLoading(false); }
  };

  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setLoading(true);
    try {
      const user = mode === 'signup'
        ? await signUpWithEmail(email.trim(), password, name.trim() || undefined)
        : await signInWithEmail(email.trim(), password);
      done(user);
    } catch (err: any) { setError(authErrorMessage(err?.code)); setLoading(false); }
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-white/10 bg-zinc-900 p-6 text-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-bold">
            {mode === 'signup' ? 'Créer un compte' : 'Se connecter'}
          </h2>
          <button onClick={onClose} className="text-white/40 hover:text-white text-xl leading-none">×</button>
        </div>
        {reason && <p className="mb-4 text-xs text-white/50">{reason}</p>}
        {!reason && <div className="mb-4" />}

        <button
          onClick={handleGoogle}
          disabled={loading}
          className="mb-4 flex w-full items-center justify-center gap-2 rounded-lg bg-white py-2.5 text-sm font-medium text-zinc-900 hover:bg-zinc-100 disabled:opacity-60"
        >
          <svg width="16" height="16" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.1-11.3-7.6l-6.5 5C9.6 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.6l6.2 5.2c-.4.4 6.6-4.8 6.6-14.8 0-1.3-.1-2.4-.4-3.5z"/></svg>
          Continuer avec Google
        </button>

        <div className="mb-4 flex items-center gap-3 text-[11px] text-white/30">
          <div className="h-px flex-1 bg-white/10" /> ou <div className="h-px flex-1 bg-white/10" />
        </div>

        <form onSubmit={handleEmail} className="space-y-3">
          {mode === 'signup' && (
            <input
              type="text" placeholder="Nom (optionnel)" value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-zinc-800 px-3 py-2 text-sm outline-none focus:border-emerald-500"
            />
          )}
          <input
            type="email" required placeholder="Adresse e-mail" value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-zinc-800 px-3 py-2 text-sm outline-none focus:border-emerald-500"
          />
          <input
            type="password" required placeholder="Mot de passe" value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-zinc-800 px-3 py-2 text-sm outline-none focus:border-emerald-500"
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
          <button
            type="submit" disabled={loading}
            className="w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold hover:bg-emerald-500 disabled:opacity-60"
          >
            {loading ? '…' : mode === 'signup' ? 'Créer mon compte' : 'Se connecter'}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-white/50">
          {mode === 'signup' ? 'Déjà un compte ?' : 'Pas encore de compte ?'}{' '}
          <button
            onClick={() => { setError(null); setMode(mode === 'signup' ? 'signin' : 'signup'); }}
            className="font-medium text-emerald-400 hover:underline"
          >
            {mode === 'signup' ? 'Se connecter' : 'Créer un compte'}
          </button>
        </p>
      </div>
    </div>
  );
};

export default AuthModal;
