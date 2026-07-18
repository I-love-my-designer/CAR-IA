import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { subscribeAuth, ensureGuest, isGuest, logout, type AuthUser } from './auth';
import { customDb } from './firebase';
import AuthModal from '../components/AuthModal';
import HistoryModal from '../components/HistoryModal';
import FavorisModal from '../components/FavorisModal';
import MonEspacePanel from '../components/MonEspacePanel';

interface AuthCtx {
  user: AuthUser | null;
  isGuest: boolean;
  /** true only for a signed-in account that has PAID / subscribed (removes the watermark, unlocks clean HD). */
  isEntitled: boolean;
  plan: string | null;
  /** Run `onSuccess` if already signed in, otherwise open the login modal first. */
  requireAccount: (reason?: string, onSuccess?: () => void) => void;
  openAuth: (reason?: string) => void;
  /** Brand Kit modal open state — rendered by MainApp (needs generation state to apply). */
  brandKitOpen: boolean;
  openBrandKit: () => void;
  closeBrandKit: () => void;
  /** Studio CUSTOM open state — rendered by MainApp (needs API url + brand logo + storage). */
  customOpen: boolean;
  openCustom: () => void;
  closeCustom: () => void;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export const useAuth = (): AuthCtx => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth must be used within <AuthProvider>');
  return c;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [plan, setPlan] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [favorisOpen, setFavorisOpen] = useState(false);
  const [brandKitOpen, setBrandKitOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [spaceOpen, setSpaceOpen] = useState(false);
  const [reason, setReason] = useState<string | undefined>(undefined);
  const pending = useRef<(() => void) | null>(null);

  useEffect(() => {
    const unsub = subscribeAuth(async (u) => {
      setUser(u);
      setReady(true);
      // Read the paid/subscription status from Firestore (users/{uid}). Only a real
      // account can be entitled; guests never are. Write is server-only (see rules),
      // so the client cannot self-grant entitlement.
      if (u && !u.isAnonymous) {
        try {
          const snap = await getDoc(doc(customDb, 'users', u.uid));
          setPlan(snap.exists() ? ((snap.data() as any)?.plan ?? ((snap.data() as any)?.entitled ? 'pro' : null)) : null);
        } catch {
          setPlan(null); // read blocked / offline → treat as free (watermark stays: safe default)
        }
      } else {
        setPlan(null);
      }
    });
    // Make sure there's always at least a guest identity for uploads/jobs.
    ensureGuest();
    return unsub;
  }, []);

  const guest = isGuest(user);
  const isEntitled = !guest && !!plan && plan !== 'free';

  const openAuth = (r?: string) => { setReason(r); setModalOpen(true); };

  const requireAccount = (r?: string, onSuccess?: () => void) => {
    if (!isGuest(user)) { onSuccess?.(); return; }
    pending.current = onSuccess || null;
    setReason(r);
    setModalOpen(true);
  };

  const onSuccess = () => {
    const cb = pending.current; pending.current = null;
    setModalOpen(false);
    if (cb) setTimeout(cb, 0);
  };

  return (
    <Ctx.Provider value={{ user, isGuest: guest, isEntitled, plan, requireAccount, openAuth, brandKitOpen, openBrandKit: () => setBrandKitOpen(true), closeBrandKit: () => setBrandKitOpen(false), customOpen, openCustom: () => setCustomOpen(true), closeCustom: () => setCustomOpen(false), logout }}>
      {children}

      {/* Floating account chip — available on every screen, non-invasive.
          Masqué quand un studio plein écran (CUSTOM / Brand Kit) est ouvert :
          le chip recouvrait leur croix de fermeture en haut à droite. */}
      {ready && !customOpen && !brandKitOpen && (
        <div className="fixed right-3 top-3 z-[9990]">
          {guest ? (
            <button
              onClick={() => openAuth()}
              className="rounded-full border border-white/15 bg-black/50 px-4 py-1.5 text-xs font-medium text-white backdrop-blur hover:bg-black/70"
            >
              Se connecter
            </button>
          ) : (
            /* Avatar SEUL (pas de nom) : le cartouche complet recouvrait le titre
               de l'app. Pattern standard (Google, Airbnb…) : un cercle discret
               avec l'initiale, le nom complet vit dans « Mon espace ». */
            <button
              onClick={() => setSpaceOpen(true)}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-emerald-600 text-[12px] font-bold text-white shadow-md backdrop-blur hover:brightness-110"
              title="Mon espace"
              aria-label="Mon espace"
            >
              {(user?.displayName || user?.email || 'U').trim()[0]?.toUpperCase()}
            </button>
          )}
        </div>
      )}

      <AuthModal
        open={modalOpen}
        reason={reason}
        onClose={() => setModalOpen(false)}
        onSuccess={onSuccess}
      />

      <HistoryModal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        userId={user?.uid ?? null}
        isEntitled={isEntitled}
      />

      <FavorisModal
        open={favorisOpen}
        onClose={() => setFavorisOpen(false)}
        userId={user?.uid ?? null}
      />

      <MonEspacePanel
        open={spaceOpen}
        onClose={() => setSpaceOpen(false)}
        user={user}
        plan={plan}
        isEntitled={isEntitled}
        onOpenAnnonces={() => { setSpaceOpen(false); setHistoryOpen(true); }}
        onOpenFavoris={() => { setSpaceOpen(false); setFavorisOpen(true); }}
        onOpenCustom={() => { setSpaceOpen(false); setCustomOpen(true); }}
        onOpenBrandKit={() => { setSpaceOpen(false); setBrandKitOpen(true); }}
        onOpenAbonnement={() => setSpaceOpen(false)}
        onLogout={() => { setSpaceOpen(false); logout(); }}
      />
    </Ctx.Provider>
  );
};
