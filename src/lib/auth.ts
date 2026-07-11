// Authentication helpers — Google + Email/Password, with anonymous "guest" mode
// that upgrades (links) to a permanent account so the guest's work is kept.
import {
  GoogleAuthProvider,
  EmailAuthProvider,
  signInAnonymously,
  signInWithPopup,
  signInWithCredential,
  linkWithPopup,
  linkWithCredential,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  type User,
} from 'firebase/auth';
import { auth } from './firebase';

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export type AuthUser = User;

export const isGuest = (u: User | null): boolean => !u || u.isAnonymous;

/** Ensure there is always a user (anonymous guest) so uploads/jobs have a uid. */
export async function ensureGuest(): Promise<User | null> {
  if (auth.currentUser) return auth.currentUser;
  try {
    const cred = await signInAnonymously(auth);
    return cred.user;
  } catch (e: any) {
    // Anonymous auth disabled in the Firebase console → app still works as "guest"
    console.warn('[AUTH] Anonymous sign-in unavailable (enable it in Firebase console for guest mode):', e?.code || e);
    return null;
  }
}

/** Sign in / sign up with Google. Upgrades the anonymous guest if there is one. */
export async function signInWithGoogle(): Promise<User> {
  const current = auth.currentUser;
  try {
    if (current?.isAnonymous) {
      const res = await linkWithPopup(current, googleProvider);
      return res.user;
    }
    const res = await signInWithPopup(auth, googleProvider);
    return res.user;
  } catch (e: any) {
    // The Google account already has its own Firebase account (e.g. same address as an
    // existing email/password account). Sign in with the credential carried by the error —
    // WITHOUT opening a second popup, which browsers would block.
    if (e?.code === 'auth/credential-already-in-use' || e?.code === 'auth/email-already-in-use') {
      const cred = GoogleAuthProvider.credentialFromError(e);
      if (cred) {
        const res = await signInWithCredential(auth, cred);
        return res.user;
      }
    }
    throw e;
  }
}

/** Create an account with email/password. Upgrades the anonymous guest if there is one. */
export async function signUpWithEmail(email: string, password: string, displayName?: string): Promise<User> {
  const current = auth.currentUser;
  let user: User;
  if (current?.isAnonymous) {
    const credential = EmailAuthProvider.credential(email, password);
    try {
      const res = await linkWithCredential(current, credential);
      user = res.user;
    } catch (e: any) {
      if (e?.code === 'auth/email-already-in-use') {
        // Address already registered → sign the user into that existing account instead.
        const res = await signInWithEmailAndPassword(auth, email, password);
        user = res.user;
      } else {
        throw e;
      }
    }
  } else {
    const res = await createUserWithEmailAndPassword(auth, email, password);
    user = res.user;
  }
  if (displayName && user && !user.displayName) {
    try { await updateProfile(user, { displayName }); } catch { /* non-blocking */ }
  }
  return user;
}

/** Sign in to an existing email/password account. */
export async function signInWithEmail(email: string, password: string): Promise<User> {
  const res = await signInWithEmailAndPassword(auth, email, password);
  return res.user;
}

/** Sign out and immediately return to guest mode. */
export async function logout(): Promise<void> {
  await signOut(auth);
  await ensureGuest();
}

/** Subscribe to auth state changes. Returns the unsubscribe function. */
export function subscribeAuth(cb: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, cb);
}

/** Turn a Firebase auth error code into a friendly French message. */
export function authErrorMessage(code?: string): string {
  switch (code) {
    case 'auth/invalid-email': return "Adresse e-mail invalide.";
    case 'auth/missing-password': return "Merci de saisir un mot de passe.";
    case 'auth/weak-password': return "Mot de passe trop faible (6 caractères minimum).";
    case 'auth/email-already-in-use': return "Cette adresse a déjà un compte — connectez-vous.";
    case 'auth/invalid-credential':
    case 'auth/wrong-password': return "E-mail ou mot de passe incorrect.";
    case 'auth/user-not-found': return "Aucun compte pour cette adresse.";
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request': return "Connexion Google annulée.";
    case 'auth/popup-blocked': return "La fenêtre Google a été bloquée par le navigateur — autorisez les pop-ups pour ce site puis réessayez.";
    case 'auth/account-exists-with-different-credential': return "Un compte existe déjà avec cette adresse via une autre méthode.";
    case 'auth/unauthorized-domain': return "Domaine non autorisé pour la connexion Google (console Firebase → Authentication → Settings → Domaines autorisés).";
    case 'auth/network-request-failed': return "Problème de réseau — vérifiez votre connexion et réessayez.";
    case 'auth/operation-not-allowed': return "Méthode de connexion non activée dans Firebase (console → Authentication).";
    case 'auth/too-many-requests': return "Trop de tentatives, réessayez plus tard.";
    default: return "Une erreur est survenue. Réessayez.";
  }
}
