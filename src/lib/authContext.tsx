import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { subscribeAuth, ensureGuest, isGuest, logout, type AuthUser } from './auth';
import { customDb } from './firebase';
import AuthModal from '../components/AuthModal';
import HistoryModal from '../components/HistoryModal';
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
  const [brandKitOpen, setBrandKitOpen] = useState(false);
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
    <Ctx.Provider value={{ user, isGuest: guest, isEntitled, plan, requireAccount, openAuth, brandKitOpen, openBrandKit: () => setBrandKitOpen(true), closeBrandKit: () => setBrandKitOpen(false), logout }}>
      {children}

      {/* Floating account chip — available on every screen, non-invasive */}
      {ready && (
        <div className="fixed right-3 top-3 z-[9990]">
          {guest ? (
            <button
              onClick={() => openAuth()}
              className="rounded-full border border-white/15 bg-black/50 px-4 py-1.5 text-xs font-medium text-white backdrop-blur hover:bg-black/70"
            >
              Se connecter
            </button>
          ) : (
            <button
              onClick={() => setSpaceOpen(true)}
              className="flex items-center gap-2 rounded-full border border-white/15 bg-black/50 py-1 pl-1 pr-3 text-xs text-white backdrop-blur hover:bg-black/70"
              title="Mon espace"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-600 text-[11px] font-bold">
                {(user?.displayName || user?.email || 'U').trim()[0]?.toUpperCase()}
              </span>
              <span className="max-w-[110px] truncate text-white/70">
                {user?.displayName || user?.email || 'Mon espace'}
              </span>
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

      <MonEspacePanel
        open={spaceOpen}
        onClose={() => setSpaceOpen(false)}
        user={user}
        plan={plan}
        isEntitled={isEntitled}
        onOpenAnnonces={() => { setSpaceOpen(false); setHistoryOpen(true); }}
        onOpenFavoris={() => {}}
        onOpenBrandKit={() => { setSpaceOpen(false); setBrandKitOpen(true); }}
        onOpenAbonnement={() => setSpaceOpen(false)}
        onLogout={() => { setSpaceOpen(false); logout(); }}
      />
    </Ctx.Provider>
  );
};
