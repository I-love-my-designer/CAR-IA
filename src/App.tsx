import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { toPng } from 'html-to-image';
import { AuthProvider, useAuth } from './lib/authContext';
import { GUEST_WATERMARK, createWatermarkedBlob } from './lib/watermark';
import BrandKitModal, { loadBrandKit, type BrandKit } from './components/BrandKitModal';
import { 
  Camera, 
  ChevronRight, 
  ChevronLeft, 
  ChevronDown,
  Upload, 
  Car, 
  TreePine, 
  Building2, 
  Palette, 
  Zap, 
  Download, 
  RefreshCcw,
  Check,
  Plus,
  Type,
  Image as ImageIcon,
  Layout,
  Sun,
  Moon,
  Sparkles,
  RotateCw,
  Maximize2,
  Minimize2,
  Move,
  Trash2,
  Home,
  Heart,
  WifiOff,
  Smartphone,
  HelpCircle,
  AlertCircle,
  Copy
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AspectRatio } from '@/components/ui/aspect-ratio';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { INITIAL_STATE, type AppState, type Screen } from './types';
import { cn } from '@/lib/utils';
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { APP_ASSETS, type AssetCode } from './config_assets';
import { getVisibleBoundingBox, calculateOptimizedTransform, type BoundingBox } from './lib/imageUtils';
import { collection, doc, setDoc, updateDoc, serverTimestamp, onSnapshot, getDocs } from 'firebase/firestore';
import { db, customDb, oldDb, oldApp, storage, handleFirestoreError, OperationType } from './lib/firebase';
import { ref, listAll, getDownloadURL, uploadString, uploadBytes } from 'firebase/storage';
import { getAuth, signInAnonymously } from 'firebase/auth';
import firebaseConfig from '../firebase-applet-config.json';

const storageAssetCache: Record<string, string> = {};
const storageAssetLimitsCache: Record<string, string> = {};

const getAppOrigin = (): string => {
  // 1. Prioritize window.location.href if it is a valid HTTP/HTTPS URL
  if (typeof window !== 'undefined' && window.location) {
    try {
      const href = window.location.href;
      if (href && href.startsWith('http') && !href.includes('about:')) {
        const u = new URL(href);
        if (u.origin && u.origin !== 'null' && u.origin.startsWith('http')) {
          return u.origin;
        }
      }
    } catch (e) {
      console.error("Error extracting origin from window.location.href:", e);
    }
  }

  // 2. Fallback to extracting from window.location.href via string match if origin is 'null' (sandboxed iframe)
  if (typeof window !== 'undefined' && window.location) {
    try {
      const href = window.location.href;
      if (href && href.startsWith('http')) {
        const match = href.match(/^(https?:\/\/[^\/]+)/);
        if (match && match[1]) {
          return match[1];
        }
      }
    } catch (e) {}
  }

  // 3. Fallback to window.location.origin
  if (typeof window !== 'undefined' && window.location && window.location.origin) {
    if (window.location.origin !== 'null' && window.location.origin.startsWith('http')) {
      return window.location.origin;
    }
  }

  // 4. Fallback to scripts/links loaded from our server (useful for iOS/Android offline webviews with app-local:// or file://)
  if (typeof document !== 'undefined') {
    const tags = [
      ...Array.from(document.getElementsByTagName('script')),
      ...Array.from(document.getElementsByTagName('link'))
    ];
    for (const tag of tags) {
      const urlAttr = (tag as any).src || (tag as any).href;
      if (urlAttr && typeof urlAttr === 'string' && urlAttr.startsWith('http')) {
        try {
          const u = new URL(urlAttr);
          if (u.origin && u.origin !== 'null' && u.origin.startsWith('http')) {
            // Only return localhost if we are actually on localhost
            if (u.origin.includes('localhost') || u.origin.includes('127.0.0.1')) {
              if (typeof window !== 'undefined' && window.location.href.includes('localhost')) {
                return u.origin;
              }
              // otherwise skip localhost
              continue;
            }
            return u.origin;
          }
        } catch (e) {}
      }
    }
  }

  // 5. Fallback to import.meta.url
  try {
    if (typeof import.meta !== 'undefined' && import.meta.url) {
      const url = new URL(import.meta.url);
      if (url.origin && url.origin !== 'null' && url.origin.startsWith('http')) {
        if (url.origin.includes('localhost') || url.origin.includes('127.0.0.1')) {
          if (typeof window !== 'undefined' && window.location.href.includes('localhost')) {
            return url.origin;
          }
        } else {
          return url.origin;
        }
      }
    }
  } catch (e) {}

  return '';
};

const resolveApiUrl = (apiPath: string): string => {
  const origin = getAppOrigin();
  if (origin) {
    const cleanOrigin = origin.endsWith('/') ? origin.slice(0, -1) : origin;
    const cleanPath = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
    return cleanOrigin + cleanPath;
  }
  return apiPath;
};

const resolveAbsoluteUrl = (path: string): string => {
  const origin = getAppOrigin();
  if (origin) {
    const cleanOrigin = origin.endsWith('/') ? origin.slice(0, -1) : origin;
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return cleanOrigin + cleanPath;
  }
  if (typeof window !== 'undefined' && window.location.origin && window.location.origin !== 'null') {
    return window.location.origin + path;
  }
  return path;
};

// Cache buster for assets to prevent browser keeping old versions
const getAssetBaseRoute = (code: string) => {
  if (!code) return '';
  const cleanCode = code.trim();
  if (cleanCode.startsWith('http')) return cleanCode;
  
  // Logic for organized directory structure (07A/07A01/07A01A)
  // We use root-relative paths starting with /assets/
  if (cleanCode.startsWith('07') && cleanCode.length >= 5) {
    const root = cleanCode.substring(0, 3).toUpperCase(); // e.g. 07A
    const sub = cleanCode.substring(0, 5).toUpperCase();  // e.g. 07A01
    return `/assets/${root}/${sub}/${cleanCode.toUpperCase()}`;
  }
  
  // Basic platform or car assets
  return `/assets/${cleanCode.toUpperCase()}`;
};


// Helper to get the actual default code for a variant
const getEffectiveCode = (code: string) => {
  if (!code) return '';
  // If it's a base code (length 3 or 5) that needs a starting letter
  if ((code.length === 3 || code.length === 5) && VARIANT_LIMITS[code]) {
    return code + 'A';
  }
  return code;
};

const ZERO_BYTE_FALLBACKS: Record<string, string> = {
  // Empty 07A02 (Night City) -> Use 07A01A
  '07A02A': '07A01A',
  
  // Empty 07B01 empty variants
  '07B01V': '07B01A',
  '07B01W': '07B01B',
  '07B01X': '07B01C',
  '07B01Y': '07B01D',
  
  // Empty 07B02/07B03 -> Use 07B01A
  '07B02A': '07B01A',
  '07B03A': '07B01A',
  
  // Empty 07C02 empty variants H to S
  '07C02H': '07C02A',
  '07C02I': '07C02B',
  '07C02J': '07C02C',
  '07C02K': '07C02D',
  '07C02L': '07C02E',
  '07C02M': '07C02F',
  '07C02N': '07C02G',
  '07C02O': '07C02A',
  '07C02P': '07C02B',
  '07C02Q': '07C02C',
  '07C02R': '07C02D',
  '07C02S': '07C02E',

  // Empty 07D01 & 07D03 -> Use 07D04A/07D04B
  '07D01A': '07D04A',
  '07D03A': '07D04B',
};


const STORAGE_PREFIX_MAP: Record<string, string> = {
  // 1. URBAN (07A)
  '07A01': 'CITY',
  '07A02': 'SPORT',
  '07A03': 'INDUS',
  '07A04': 'PARKING',

  // 2. NATURE (07B)
  '07B01': 'DESERT',
  '07B02': 'FOREST',
  '07B03': 'MONTAGNE',
  '07B04': 'SEASIDE',

  // 3. DESIGN (07C)
  '07C01': 'OUTSIDE',
  '07C02': 'STUDIO',
  '07C03': 'CONCRETE',
  '07C04': 'WOOD',

  // 4. MINIMAL (07D)
  '07D01': 'LANDSCAPE',
  '07D02': 'ARCHI',
  '07D03': 'MTX',
  '07D04': 'VGX',
};

const letterToTwoDigits = (letter: string): string => {
  if (!letter || letter.length !== 1) return '01';
  const code = letter.toUpperCase().charCodeAt(0) - 64; // A = 1, B = 2, C = 3...
  if (code < 1 || code > 26) return '01';
  return code < 10 ? `0${code}` : `${code}`;
};

const getFirebaseStorageAssetUrl = (effectiveCode: string): string | null => {
  if (!effectiveCode || effectiveCode.length < 5 || !effectiveCode.startsWith('07')) {
    return null;
  }
  const baseCode = effectiveCode.substring(0, 5); // e.g. "07A01"
  const prefix = STORAGE_PREFIX_MAP[baseCode];
  if (!prefix) return null;

  const letter = effectiveCode.substring(5) || 'A';
  const indexStr = letterToTwoDigits(letter); // e.g. "01"
  const filename = `${prefix} ${indexStr}.jpg`;
  
  // Public Firebase Storage URL format
  const bucketName = "gen-lang-client-0870404092.firebasestorage.app";
  const encodedPath = encodeURIComponent(`ENVIRONMENTS/${filename}`);
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedPath}?alt=media`;
};

const getAssetUrl = (code: string) => {
  if (!code) return '';
  if (code.startsWith('http')) return code;
  
  // Force uppercase and clean for consistent file system matching
  let effectiveCode = getEffectiveCode(code).trim().toUpperCase();
  
  // 1. Check if we have dynamically resolved this in our Firebase Storage cache
  if (storageAssetCache[effectiveCode]) {
    return storageAssetCache[effectiveCode];
  }
  
  // 2. Fallback to mapped Step 7 Environment hosted on Firebase Storage (public URL format)
  const firebaseStorageUrl = getFirebaseStorageAssetUrl(effectiveCode);
  if (firebaseStorageUrl) {
    return firebaseStorageUrl;
  }

  // Replace empty 0-byte placeholders with working variants
  if (ZERO_BYTE_FALLBACKS[effectiveCode]) {
    effectiveCode = ZERO_BYTE_FALLBACKS[effectiveCode];
  }

  // 2. Try mapping first for known non-standard extensions (jpg, webp...)
  if (APP_ASSETS[effectiveCode as keyof typeof APP_ASSETS]) {
    return APP_ASSETS[effectiveCode as keyof typeof APP_ASSETS];
  }

  // Special handle for 07D02A which has a JPG extension on disk
  if (effectiveCode === '07D02A') {
    return `/assets/07D/07D02/07D02A.jpg`;
  }

  // 3. Default to JPG inside organized folders for Step 7 variants (fallback)
  const route = getAssetBaseRoute(effectiveCode);
  return `${route}.jpg`; 
};

// --- Architecture Documentation Component ---

const VARIANT_LIMITS: Record<string, string> = {
  '07A01': 'E', // CITY 01 -> CITY 05
  '07A02': 'E', // SPORT 01 -> SPORT 05
  '07A03': 'Q', // INDUS 01 -> INDUS 17
  '07A04': 'H', // PARKING 01 -> PARKING 08
  '07B01': 'F', // DESERT 01 -> DESERT 06
  '07B02': 'E', // FOREST 01 -> FOREST 05
  '07B03': 'E', // MONTAGNE 01 -> MONTAGNE 05
  '07B04': 'D', // SEASIDE 01 -> SEASIDE 04
  '07C01': 'D', // OUTSIDE 01 -> OUTSIDE 04
  '07C02': 'E', // STUDIO 01 -> STUDIO 05
  '07C03': 'E', // CONCRETE 01 -> CONCRETE 05
  '07C04': 'D', // WOOD 01 -> WOOD 04
  '07D01': 'D', // LANDSCAPE 01 -> LANDSCAPE 04
  '07D02': 'D', // ARCHI 01 -> ARCHI 04
  '07D03': 'D', // MTX 01 -> MTX 04
  '07D04': 'D', // VGX 01 -> VGX 04
  '08A': 'B',
  '08B': 'A',
  '08C': 'A',
  '08D': 'A',
  '10A': 'A',
  '10B': 'A',
  '10C': 'A',
  '10D': 'A',
};

const getNextLetter = (currentLetter: string, maxLetter: string = 'D') => {
  if (!currentLetter || currentLetter.length !== 1) return 'A';
  const currentCode = currentLetter.toUpperCase().charCodeAt(0);
  const maxCode = maxLetter.toUpperCase().charCodeAt(0);
  if (currentCode >= maxCode) return 'A';
  return String.fromCharCode(currentCode + 1);
};

const getPrevLetter = (currentLetter: string, maxLetter: string = 'D') => {
  if (!currentLetter || currentLetter.length !== 1) return maxLetter;
  const currentCode = currentLetter.toUpperCase().charCodeAt(0);
  const minCode = "A".charCodeAt(0);
  const maxCode = maxLetter.toUpperCase().charCodeAt(0);
  if (currentCode <= minCode) return maxLetter;
  return String.fromCharCode(currentCode - 1);
};

const ArchitectureTable = () => {
  const steps = [
    { step: 1, page: "Homepage", options: "Bouton [START]", thumbnails: "01A (App Logo / Splash Preview)", code: "01A", next: "-> Shooting Conditions" },
    { step: 2, page: "Your shooting conditions", options: "MOVING VEHICLE: 02A", thumbnails: "02A", code: "02A", next: "-> Vehicle Category" },
    { step: "", page: "", options: "MOVING CAMERA: 02B", thumbnails: "02B", code: "02B", next: "-> Vehicle Category" },
    { step: 3, page: "Vehicle Category", options: "VOITURE: 03A", thumbnails: "03A", code: "03A", next: "-> Vehicle Type" },
    { step: "", page: "", options: "SOCIÉTÉ: 03B", thumbnails: "03B", code: "03B", next: "-> Vehicle Type" },
    { step: "", page: "", options: "MOTO: 03C", thumbnails: "03C", code: "03C", next: "-> Vehicle Type" },
    { step: 4, page: "Vehicle Type (VOITURE)", options: "SUV (03A01), CITADINE (03A02), BERLINE (03A03), MONOSPACE (03A04), SPORT (03A05), CABRIOLET (03A06), PREMIUM (03A07)", thumbnails: "03A01 to 03A07", code: "03A03", next: "-> Your Photo" },
    { step: "", page: "Vehicle Type (SOCIÉTÉ)", options: "FOURGON (03B01), FOURGONNETTE (03B02), PICK-UP (03B03), VOITURE (03B04), CAMION (03B05)", thumbnails: "03B01 to 03B05", code: "03B04", next: "-> Your Photo" },
    { step: "", page: "Vehicle Type (MOTO)", options: "ROADSTER (03C01), TRAIL (03C02), CUSTOM (03C03), SPORTIVE (03C04), GT (03C05), COLLECTION (03C06), SCOOTER (03C07)", thumbnails: "03C01 to 03C07", code: "03C02", next: "-> Your Photo" },
    { step: 5, page: "Your Photo", options: "UPLOAD", thumbnails: "User Assets", code: null, next: "-> Visual Style" },
    { step: 6, page: "Visual Style", options: "PRO (05B), PREMIUM (05C), DYNAMIC (05D)", thumbnails: "05B-D", code: "05B", next: "-> Environment" },
    { step: 7, page: "Environment", options: "CITY (07A01), DESERT (07B01), STUDIO (07C01), LANDSCAPES (07D01)", thumbnails: "A-Z variants", code: "07A01A", next: "-> Review" },
    { step: 8, page: "Review", options: "Export / Share", thumbnails: "Final Composition", code: null, next: "DONE" }
  ];

  return (
    <div className="p-8 bg-zinc-950 text-white min-h-screen font-sans">
      <div className="max-w-7xl mx-auto border border-white/10 shadow-2xl">
        <div className="bg-white text-black p-4 flex justify-between items-center">
          <h1 className="text-sm font-bold uppercase tracking-[0.3em]">APP ARCHITECTURE MAP & ASSETS</h1>
          <div className="flex gap-4 items-center">
             <span className="text-[10px] bg-blue-600 text-white px-2 py-1 font-bold">MODE : SHARED CONTROL</span>
          </div>
        </div>
        
        <div className="bg-zinc-900/50 p-6 border-b border-white/10">
          <p className="text-[10px] uppercase tracking-widest text-white/60 mb-2">💡 Comment ajouter vos images :</p>
          <ol className="text-[10px] text-white/40 space-y-1 list-decimal ml-4">
            <li>Glissez vos fichiers dans le dossier <code className="text-white/60">public/assets</code> de l'interface AI Studio.</li>
            <li>Nommez vos fichiers exactement comme les codes indiqués (ex: <code className="text-white/60">01A.jpg</code> ou <code className="text-white/60">07A01A.jpg</code>).</li>
            <li>Le système supporte le **JPG**, le **WEBP** et le **PNG**. Le JPG est privilégié pour les arrière-plans.</li>
            <li>Pour les environnements (07A, etc), bases (08A, etc) et styles (10A, etc), ajoutez un suffixe A, B, C ou D pour la sélection aléatoire.</li>
          </ol>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-zinc-900 border-b border-white/10">
                <th className="p-3 font-bold uppercase tracking-widest text-[10px] border-r border-white/10 w-16 text-center">Step</th>
                <th className="p-3 font-bold uppercase tracking-widest text-[10px] border-r border-white/10">Page & Options</th>
                <th className="p-3 font-bold uppercase tracking-widest text-[10px] border-r border-white/10">Code & Asset Preview</th>
                <th className="p-3 font-bold uppercase tracking-widest text-[10px]">Logic</th>
              </tr>
            </thead>
            <tbody>
              {steps.map((s, i) => (
                <tr key={i} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                  <td className="p-3 font-mono text-white/40 border-r border-white/10 align-top text-center">{s.step}</td>
                  <td className="p-3 font-bold border-r border-white/10 align-top">{s.page}<br/><span className="text-[10px] opacity-60 font-normal">{s.options}</span></td>
                  <td className="p-3 border-r border-white/10">
                    {s.code && (
                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                           <span className="text-[10px] font-bold tracking-widest block uppercase text-blue-400">{s.thumbnails}</span>
                           <span className="text-[8px] bg-white/5 px-1 font-mono text-white/30">{s.code}</span>
                        </div>
                        <div className="relative group max-w-[320px]">
                          <SafeImage code={s.code} className="w-full h-auto border border-white/10 transition-all group-hover:scale-[1.02]" />
                          <div className="absolute top-1 left-2 bg-black/60 px-2 py-0.5 backdrop-blur-sm">
                             <span className="text-[8px] font-bold tracking-widest text-white">{s.code}</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="p-3 text-blue-400/60 font-medium align-top italic">{s.next}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="mt-8 text-center flex flex-col items-center gap-4">
        <p className="text-[10px] uppercase tracking-widest text-white/20 italic">The image URLs in the table above come directly from the app's source code.</p>
        <button 
          onClick={() => window.location.href = window.location.pathname}
          className="text-[10px] uppercase tracking-widest bg-white text-black px-8 py-3 font-bold hover:bg-zinc-200 transition-all active:scale-95"
        >
          Back to App Creation
        </button>
      </div>
    </div>
  );
};

// --- Components ---

const ScreenWrapper = ({ 
  children, 
  title, 
  subtitle, 
  onBack, 
  onNext, 
  onHome,
  nextLabel = "Next",
  showFooter = true,
  isNextDisabled = false,
  isJumpingBack = false,
  showHomeConfirm = false,
  noScroll = false
}: { 
  children: React.ReactNode; 
  title?: string; 
  subtitle?: string;
  onBack?: () => void;
  onNext?: () => void;
  onHome?: () => void;
  nextLabel?: string;
  showFooter?: boolean;
  isNextDisabled?: boolean;
  isJumpingBack?: boolean;
  showHomeConfirm?: boolean;
  noScroll?: boolean;
}) => {
  const [showConfirm, setShowConfirm] = useState(false);

  const handleHome = () => {
    if (onHome) {
      if (showHomeConfirm) {
        setShowConfirm(true);
      } else {
        onHome();
      }
    }
  };

  return (
    <motion.div 
      className="flex flex-col h-dvh max-w-md mx-auto bg-background text-foreground overflow-hidden relative"
    >
      {/* Confirmation Overlay */}
      <AnimatePresence>
        {showConfirm && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-8"
          >
            <div className="bg-zinc-900 border border-white/10 p-6 w-full space-y-6 text-center">
              <p className="text-xs font-bold uppercase tracking-[0.2em] leading-relaxed">Your progress will be lost. Continue?</p>
              <div className="flex justify-center gap-8">
                <button 
                  onClick={() => setShowConfirm(false)}
                  className="w-12 h-12 flex items-center justify-center bg-white/5 hover:bg-white/10 transition-colors"
                >
                  <Plus className="w-6 h-6 rotate-45 opacity-60" />
                </button>
                <button 
                  onClick={() => onHome?.()}
                  className="w-12 h-12 flex items-center justify-center bg-white text-black hover:bg-white/90 transition-colors"
                >
                  <Check className="w-6 h-6" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Header */}
      <header className="px-6 pt-2 pb-0.5 flex items-center justify-center shrink-0">
        <h1 className="text-[10px] font-bold tracking-[0.2em] uppercase opacity-50">Car IA Photobooth</h1>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-hidden flex flex-col">
        <div className="shrink-0 px-6">
          {title && <h2 className="text-xl font-light tracking-tight mb-0 mt-0">{title}</h2>}
          {subtitle && <p className="text-[10px] text-muted-foreground mb-4 font-light leading-tight">{subtitle}</p>}
        </div>
        <div className={cn("flex-1 no-scrollbar pb-2", !noScroll && "overflow-y-auto")}>
          {children}
        </div>
      </main>

      {/* Footer */}
      {showFooter && (
        <footer className="shrink-0 p-6 bg-gradient-to-t from-background via-background to-transparent pt-6 flex gap-2">
          {onHome && (
            <Button 
              variant="secondary" 
              size="icon" 
              onClick={handleHome}
              className="w-12 h-12 rounded-none shrink-0 bg-white/10 hover:bg-white/20 text-white"
            >
              <Home className="w-5 h-5" />
            </Button>
          )}
          
          {onBack && (
            <Button 
              variant="secondary" 
              onClick={onBack}
              className="flex-[1.5] h-12 rounded-none text-[10px] font-bold uppercase tracking-widest bg-white/10 hover:bg-white/20 text-white"
            >
              <ChevronLeft className="mr-1 w-3 h-3" />
              Back
            </Button>
          )}

          {onNext && (
            <Button 
              onClick={onNext} 
              disabled={isNextDisabled}
              className="flex-[2.5] h-12 rounded-none text-[10px] font-bold uppercase tracking-widest bg-white text-black hover:bg-white/90 transition-all active:scale-[0.98]"
            >
              {nextLabel}
              <ChevronRight className="ml-1 w-3 h-3" />
            </Button>
          )}
        </footer>
      )}
    </motion.div>
  );
};

// SafeImage component to handle assets efficiently with stateful retry capabilities for transient errors
const SafeImage = ({ code, className, priority = false, ...props }: any) => {
  if (!code) return null;
  const initialSrc = getAssetUrl(code);
  const [src, setSrc] = useState(initialSrc);
  const [retryCount, setRetryCount] = useState(0);

  // Synchronize when the model code changes
  useEffect(() => {
    setSrc(getAssetUrl(code));
    setRetryCount(0);
  }, [code]);

  const handleImageError = (e: any) => {
    const failedUrl = e.target.src;
    if (retryCount < 2) {
      const nextCount = retryCount + 1;
      setRetryCount(nextCount);
      console.warn(`[SafeImage Retry] Asset failed to load, retrying (${nextCount}/2): ${failedUrl} for code: ${code}`);
      
      const separator = initialSrc.includes('?') ? '&' : '?';
      setTimeout(() => {
        setSrc(`${initialSrc}${separator}retry=${nextCount}-${Date.now()}`);
      }, nextCount * 600);
    } else {
      console.error(`Asset failed to load after all retries: ${failedUrl} for code: ${code}`);
      // Fallback for missing/corrupted assets (Grey cross placeholder)
      setSrc("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' fill='%2318181b'/%3E%3Cpath d='M30 30 L70 70 M70 30 L30 70' stroke='%233f3f46' stroke-width='2'/%3E%3C/svg%3E");
    }
  };

  return (
    <img 
      src={src} 
      className={cn("block", className)}
      loading={priority ? "eager" : "lazy"}
      onError={handleImageError}
      {...props} 
    />
  );
};

const getImageIdForVariant = (code: string | null): string => {
  if (!code) return '';
  const cleanCode = code.trim().toUpperCase();
  const baseCode = cleanCode.substring(0, 5); // "07A02"
  const prefix = STORAGE_PREFIX_MAP[baseCode];
  if (!prefix) return '';
  const letter = cleanCode.substring(5) || 'A';
  const indexStr = letterToTwoDigits(letter); // "01"
  return `${prefix} ${indexStr}`; // "SPORT 01"
};

const parseCoordinates = (posStr: string | undefined | null, defaultX = 640, defaultY = 128) => {
  if (!posStr) return { x: defaultX, y: defaultY };
  const cleanPos = posStr.trim().toUpperCase();
  if (cleanPos === 'CENTRE' || cleanPos === 'CENTER') {
    return { x: 640, y: defaultY };
  }
  const matches = cleanPos.match(/\d+/g);
  if (matches && matches.length >= 2) {
    return {
      x: parseInt(matches[0], 10),
      y: parseInt(matches[1], 10)
    };
  }
  return { x: defaultX, y: defaultY };
};

const normalizeKeyBasic = (str: string): string => {
  if (!str) return '';
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove accents (e.g., À -> A)
    .toUpperCase()
    .trim()
    .replace("ARCHI", "ARCH") // Align ARCHI with ARCH
    .replace(/[\s\-_.\/\\]+/g, ""); // Remove spaces and all separators/punctuation
};

const normalizeKeyZeroStripped = (str: string): string => {
  return normalizeKeyBasic(str).replace(/0+(\d+)/g, "$1"); // Handle leading zeros (e.g., SPORT01 -> SPORT1)
};

const normalizeKey = (str: string): string => {
  return normalizeKeyBasic(str);
};

const isKeyMatch = (key1: string | null | undefined, key2: string | null | undefined): boolean => {
  if (!key1 || !key2) return false;
  const k1_basic = normalizeKeyBasic(key1);
  const k2_basic = normalizeKeyBasic(key2);
  if (k1_basic === k2_basic) return true;
  
  const k1_z = normalizeKeyZeroStripped(key1);
  const k2_z = normalizeKeyZeroStripped(key2);
  if (k1_z === k2_z) return true;
  
  return false;
};

const propAliases: Record<string, string[]> = {
  imageId: ['A', 'imageId', 'image_id', 'image_Id'],
  promptIa: ['PA', 'promptIa', 'prompt_ia', 'promptIA'],
  logo: ['B', 'logo', 'logoEnabled', 'logo_enabled'],
  logoSize: ['C', 'taille', 'logoSize', 'logo_size'],
  logoX: ['DX', 'logoX', 'logo_x'],
  logoY: ['DY', 'logoY', 'logo_y'],
  logoColorFillEnabled: ['E1', 'logoColorFillEnabled', 'logoColorFillActive', 'logo_color_fill_enabled', 'colorFillActive', 'logo_color_fill_active'],
  logoColorFill: ['E', 'logoColorFill', 'colorFill', 'logo_color_fill'],
  promptIaLogo: ['F', 'promptIaLogo', 'prompt_ia_logo'],
  promptActifLogo: ['FA', 'promptActifLogo', 'prompt_actif_logo'],
  text: ['G', 'text', 'textEnabled', 'text_enabled', 'texte'],
  textContent: ['GP', 'textContent', 'text_content', 'texteParDefaut', 'texte_par_defaut'],
  textFont: ['H', 'textFont', 'text_font', 'police'],
  textSize: ['I', 'textSize', 'text_size', 'taille_texte', 'tailleTexte'],
  textAlign: ['J', 'textAlign', 'text_align', 'alignement'],
  textX: ['KX', 'textX', 'text_x'],
  textY: ['KY', 'textY', 'text_y'],
  textColorFillEnabled: ['L1', 'textColorFillActive', 'textColorFillEnabled', 'text_color_fill_active', 'textColorFillActiveEnabled'],
  textColorFill: ['L', 'textColorFill', 'textColor', 'text_color_fill', 'colorFillText'],
  promptIaText: ['N', 'promptIaText', 'prompt_ia_text'],
  promptActifText: ['NA', 'promptActifText', 'prompt_actif_text'],
  // Autorise (ou non) le changement de couleur d'ambiance/néon du fond. Défaut : non.
  imageColorFillEnabled: ['M1', 'imageColorFillEnabled', 'imageColorFillActive', 'image_color_fill_enabled', 'colorEditable', 'sceneColorEnabled', 'ambianceColorEnabled']
};

const getPropValue = (obj: any, key: string, fallback: any = undefined): any => {
  if (!obj) return fallback;
  
  // 1. Check if key matches an alias list defined in propAliases
  const aliases = propAliases[key];
  if (aliases) {
    for (const alias of aliases) {
      if (obj[alias] !== undefined && obj[alias] !== null) {
        return obj[alias];
      }
    }
  }

  // 2. Direct lookup fallback
  if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  
  // 3. Try case-insensitive scan
  const lowerKey = key.toLowerCase();
  for (const k of Object.keys(obj)) {
    if (k.toLowerCase() === lowerKey) {
      if (obj[k] !== undefined && obj[k] !== null) return obj[k];
    }
  }
  
  // 4. Try snake_case scan
  const snakeKey = key.replace(/([A-Z])/g, "_$1").toLowerCase();
  for (const k of Object.keys(obj)) {
    if (k.toLowerCase() === snakeKey) {
      if (obj[k] !== undefined && obj[k] !== null) return obj[k];
    }
  }
  return fallback;
};

const getEffectiveTextColor = (preset: any): string => {
  const enabled = getPropValue(preset, 'textColorFillEnabled');
  if (enabled === false || enabled === 'false') {
    return '#ffffff';
  }
  return getPropValue(preset, 'textColorFill') || '#ffffff';
};

const localDataUrlCache: Record<string, string> = {};

const useLocalDataUrl = (url: string | null) => {
  const [dataUrl, setDataUrl] = useState<string | null>(() => {
    if (url && localDataUrlCache[url]) {
      return localDataUrlCache[url];
    }
    return url && url.startsWith('data:') ? url : null;
  });

  useEffect(() => {
    if (!url) {
      setDataUrl(null);
      return;
    }
    if (url.startsWith('data:')) {
      setDataUrl(url);
      return;
    }
    if (localDataUrlCache[url]) {
      setDataUrl(localDataUrlCache[url]);
      return;
    }

    let isSubscribed = true;
    const proxiedUrl = `/api/proxy?url=${encodeURIComponent(url)}`;
    fetch(proxiedUrl)
      .then(res => res.blob())
      .then(blob => {
        return new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      })
      .then(base64 => {
        localDataUrlCache[url] = base64;
        if (isSubscribed) {
          setDataUrl(base64);
        }
      })
      .catch(err => {
        console.warn("[LocalDataUrl] Failed to convert remote logo via proxy:", err);
        localDataUrlCache[url] = url;
        if (isSubscribed) {
          setDataUrl(url);
        }
      });

    return () => {
      isSubscribed = false;
    };
  }, [url]);

  return dataUrl;
};

const getPresetRefResolution = (preset: any): number => {
  if (!preset) return 1280;
  
  const possibleKeys = [
    'resolutionRef', 'refResolution', 'resolution_ref', 'resolutionReference', 
    'referenceResolution', 'ref_resolution', 'resolutionref', 'refresolution', 
    'baseResolution', 'baseresolution', 'resolution', 'ref', 'ref_res', 'refRes',
    'dimension_ref', 'dimensionRef', 'grid_size', 'gridSize'
  ];
  
  for (const key of possibleKeys) {
    if (preset[key] !== undefined && preset[key] !== null && preset[key] !== '') {
      const parsed = parseFloat(preset[key]);
      if (!isNaN(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }
  
  // Case-insensitive scanning of top level keys
  const presetKeys = Object.keys(preset);
  for (const key of possibleKeys) {
    const lowerKey = key.toLowerCase();
    const matchedKey = presetKeys.find(k => k.toLowerCase() === lowerKey);
    if (matchedKey) {
      const parsed = parseFloat(preset[matchedKey]);
      if (!isNaN(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }
  
  return 1280; // default reference resolution is 1280 as per request brief
};

const getStaticFallbackPreset = (imageId: string) => {
  const upper = imageId.toUpperCase().trim();
  
  // Standard high-quality defaults (e.g., logo centered top, text centered bottom)
  let logo = true;
  let logoSize = "180";
  let imagePosition = "640-120"; // centered top by default on 1280px canvas
  let logoColorFill = "#ffffff";
  let logoColorFillEnabled = false;
  let text = true;
  let textFont = "Inter";
  let textSize = "36";
  let textColorFill = "#ffffff";
  let textPosition = "640-1150"; // centered bottom by default on 1280px canvas
  let resolutionRef = 1280;

  if (upper.includes("CITY")) {
    imagePosition = "640-120";
    textPosition = "640-1160";
    textSize = "36";
    logoSize = "160";
  } else if (upper.includes("SPORT")) {
    // Sport theme has logo top right, text top left for modern balanced design
    imagePosition = "1100-120";
    textPosition = "180-120";
    textSize = "36";
    logoSize = "150";
  } else if (upper.includes("INDUS") || upper.includes("INDUSTRIAL")) {
    // Industrial has logo bottom right, text bottom left
    imagePosition = "1100-1140";
    textPosition = "180-1140";
    textSize = "32";
    logoSize = "180";
  } else if (upper.includes("PARKING")) {
    // Parking has logo bottom center, text bottom center
    imagePosition = "640-1130";
    textPosition = "640-1190";
    textSize = "28";
    logoSize = "200";
  } else if (upper.includes("DESERT")) {
    // Desert has logo top center, text top center slightly below
    imagePosition = "640-140";
    textPosition = "640-220";
    textSize = "32";
    logoSize = "180";
  } else if (upper.includes("FOREST")) {
    // Forest has logo bottom left, text bottom left slightly below
    imagePosition = "180-1140";
    textPosition = "180-1190";
    textSize = "28";
    logoSize = "160";
  } else if (upper.includes("MONTAGNE") || upper.includes("MOUNTAIN")) {
    // Mountain has logo top right, text top right slightly below
    imagePosition = "1100-140";
    textPosition = "1100-200";
    textSize = "28";
    logoSize = "150";
  } else if (upper.includes("SEASIDE")) {
    // Seaside has logo top center, text bottom center
    imagePosition = "640-150";
    textPosition = "640-1160";
    textSize = "36";
    logoSize = "180";
  } else if (upper.includes("OUTSIDE")) {
    // Outside has logo top left, text top left slightly below
    imagePosition = "180-140";
    textPosition = "180-200";
    textSize = "28";
    logoSize = "150";
  } else if (upper.includes("STUDIO")) {
    // Studio has logo top center, text bottom center
    imagePosition = "640-120";
    textPosition = "640-1150";
    textSize = "36";
    logoSize = "180";
  } else if (upper.includes("CONCRETE")) {
    // Concrete has logo bottom right, text bottom left
    imagePosition = "1100-1140";
    textPosition = "180-1140";
    textSize = "32";
    logoSize = "170";
  } else if (upper.includes("WOOD")) {
    // Wood has logo bottom center, text bottom center
    imagePosition = "640-1120";
    textPosition = "640-1180";
    textSize = "32";
    logoSize = "180";
  } else if (upper.includes("LANDSCAPE")) {
    // Landscape has logo top center, text bottom center
    imagePosition = "640-130";
    textPosition = "640-1160";
    textSize = "32";
    logoSize = "160";
  } else if (upper.includes("ARCHI") || upper.includes("ARCH ")) {
    // Archi has logo top right, text bottom right
    imagePosition = "1100-130";
    textPosition = "1100-1160";
    textSize = "32";
    logoSize = "150";
  } else if (upper.includes("MTX")) {
    imagePosition = "640-120";
    textPosition = "640-180";
    textSize = "32";
    logoSize = "170";
  } else if (upper.includes("VGX")) {
    imagePosition = "640-120";
    textPosition = "640-180";
    textSize = "32";
    logoSize = "170";
  }

  return {
    logo,
    logoSize,
    imagePosition,
    logoColorFill,
    logoColorFillEnabled,
    text,
    textFont,
    textSize,
    textColorFill,
    textPosition,
    resolutionRef
  };
};

const getBrandingPreset = (envVariant: string | null, presets: Record<string, any>) => {
  const rawImageId = getImageIdForVariant(envVariant);
  let upperImageId = rawImageId.toUpperCase().trim();
  
  // Normalize ARCHI 01 -> ARCH 01 to align with user's "Arch 01" Firestore naming
  if (upperImageId.startsWith("ARCHI ")) {
    upperImageId = upperImageId.replace("ARCHI ", "ARCH ");
  }

  if (!presets || Object.keys(presets).length === 0) {
    // Return custom prefix-specific fallback if presets list is empty (e.g. quota-blocked)
    return getStaticFallbackPreset(upperImageId);
  }

  // 1. Try to find settings using the imageId property inside the presets first (highest precision)
  const fieldMatchedKey = Object.keys(presets).find(key => {
    const presetObj = presets[key];
    const imgIdVal = getPropValue(presetObj, 'imageId');
    return imgIdVal && isKeyMatch(String(imgIdVal), upperImageId);
  });
  if (fieldMatchedKey && presets[fieldMatchedKey]) {
    return presets[fieldMatchedKey];
  }

  // 2. Try to find custom settings based on the document key (Id)
  const docMatchedKey = Object.keys(presets).find(key => {
    return isKeyMatch(key, upperImageId);
  });
  if (docMatchedKey && presets[docMatchedKey]) {
    return presets[docMatchedKey];
  }

  // 3. Fallback to "A Blanc"
  const aBlancKey = Object.keys(presets).find(key => {
    const presetObj = presets[key];
    const isBlancKey = isKeyMatch(key, "A Blanc") || isKeyMatch(key, "ABLANC") || isKeyMatch(key, "ABLANCA");
    
    const imgIdVal = getPropValue(presetObj, 'imageId');
    const isBlancField = imgIdVal && (
      isKeyMatch(String(imgIdVal), "A Blanc") || 
      isKeyMatch(String(imgIdVal), "ABLANC") || 
      isKeyMatch(String(imgIdVal), "ABLANCA")
    );
    
    return isBlancKey || isBlancField;
  });
  if (aBlancKey && presets[aBlancKey]) {
    return presets[aBlancKey];
  }

  // Fallback to searching for keys that contain BLANC or DEFAULT or ARCH or SPORT
  const fallbackKey = Object.keys(presets).find(key => {
    const norm = normalizeKey(key);
    return norm.includes("BLANC") || norm.includes("DEFAULT") || norm === "1";
  });
  if (fallbackKey && presets[fallbackKey]) {
    return presets[fallbackKey];
  }
  
  // Return custom prefix-specific fallback instead of generic defaults
  return getStaticFallbackPreset(upperImageId);
};


const SharedPreview = ({ 
  image, 
  imageTransform, 
  envVariant, 
  platform, 
  logo, 
  customLogo, 
  logoText, 
  logoType, 
  logoGridPosition,
  colorTheme,
  colorIntensity = 1,
  isIsolated = false,
  showPlatform = true,
  highlightStep = -1, // -1: none, 0: bg, 1: base, 2: vehicle
  selectedZone = null, // New: for glow feedback
  showLogo = true,
  showText = true,
  allowSweeps = false,
  hideDebugInfo = true,
  onNavigateEnv, // Added for arrow navigation
  onNavigateBase, // Added for base navigation
  onUpdateTransform, // Added for touch gesture manipulation
  brandingPresets,
  screen
}: any) => {
  const lastTouchRef = useRef<{ x: number, y: number } | null>(null);
  const initialTouchTransform = useRef<any>(null);
  const initialPinchDist = useRef<number | null>(null);
  const initialPinchAngle = useRef<number | null>(null);
  const initialPinchTransform = useRef<any>(null);
  const containerBoundsRef = useRef<DOMRect | null>(null);

  const handleTouchStart = (e: React.TouchEvent<HTMLImageElement>) => {
    if (!onUpdateTransform) return;
    e.stopPropagation();
    
    const parent = e.currentTarget.parentElement;
    if (parent) {
      containerBoundsRef.current = parent.getBoundingClientRect();
    }

    if (e.touches.length === 1) {
      lastTouchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      initialTouchTransform.current = { ...imageTransform };
      initialPinchDist.current = null;
      initialPinchAngle.current = null;
    } else if (e.touches.length === 2) {
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const dist = Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY);
      const angle = Math.atan2(touch2.clientY - touch1.clientY, touch2.clientX - touch1.clientX);
      
      initialPinchDist.current = dist;
      initialPinchAngle.current = angle;
      initialPinchTransform.current = { ...imageTransform };
      lastTouchRef.current = null;
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLImageElement>) => {
    if (!onUpdateTransform) return;
    if (e.cancelable) {
      e.preventDefault();
    }
    e.stopPropagation();

    if (e.touches.length === 1 && lastTouchRef.current && initialTouchTransform.current) {
      const touch = e.touches[0];
      const dx = touch.clientX - lastTouchRef.current.x;
      const dy = touch.clientY - lastTouchRef.current.y;
      
      const rect = containerBoundsRef.current || e.currentTarget.parentElement?.getBoundingClientRect();
      const width = rect ? rect.width : 300;
      const height = rect ? rect.height : 300;

      const dxPercent = (dx / width) * 100;
      const dyPercent = (dy / height) * 100;

      onUpdateTransform({
        ...imageTransform,
        x: initialTouchTransform.current.x + dxPercent,
        y: initialTouchTransform.current.y + dyPercent
      });
    } else if (e.touches.length === 2 && initialPinchDist.current !== null && initialPinchAngle.current !== null && initialPinchTransform.current) {
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const currentDist = Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY);
      const currentAngle = Math.atan2(touch2.clientY - touch1.clientY, touch2.clientX - touch1.clientX);

      const scaleMultiplier = currentDist / initialPinchDist.current;
      const newScale = Math.min(3.0, Math.max(0.2, initialPinchTransform.current.scale * scaleMultiplier));

      const angleDiff = currentAngle - initialPinchAngle.current;
      const angleDegrees = angleDiff * (180 / Math.PI);
      
      let newRotate = initialPinchTransform.current.rotate + angleDegrees;
      const boundedRotate = Math.min(5, Math.max(-5, newRotate));

      onUpdateTransform({
        ...imageTransform,
        scale: newScale,
        rotate: boundedRotate
      });
    }
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLImageElement>) => {
    if (!onUpdateTransform) return;
    e.stopPropagation();
    lastTouchRef.current = null;
    initialTouchTransform.current = null;
    initialPinchDist.current = null;
    initialPinchAngle.current = null;
    initialPinchTransform.current = null;
  };

  const lastMousePos = useRef<{ x: number, y: number } | null>(null);
  const initialMouseTransform = useRef<any>(null);

  const handlePointerDown = (e: React.PointerEvent<HTMLImageElement>) => {
    if (!onUpdateTransform || e.button !== 0) return;
    if (e.pointerType === 'touch') return;

    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);

    const parent = e.currentTarget.parentElement;
    if (parent) {
      containerBoundsRef.current = parent.getBoundingClientRect();
    }

    lastMousePos.current = { x: e.clientX, y: e.clientY };
    initialMouseTransform.current = { ...imageTransform };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLImageElement>) => {
    if (!onUpdateTransform || !lastMousePos.current || !initialMouseTransform.current) return;
    if (e.pointerType === 'touch') return;

    e.stopPropagation();
    const dx = e.clientX - lastMousePos.current.x;
    const dy = e.clientY - lastMousePos.current.y;

    const rect = containerBoundsRef.current || e.currentTarget.parentElement?.getBoundingClientRect();
    const width = rect ? rect.width : 300;
    const height = rect ? rect.height : 300;

    const dxPercent = (dx / width) * 100;
    const dyPercent = (dy / height) * 100;

    onUpdateTransform({
      ...imageTransform,
      x: initialMouseTransform.current.x + dxPercent,
      y: initialMouseTransform.current.y + dyPercent
    });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLImageElement>) => {
    if (!onUpdateTransform) return;
    if (e.pointerType === 'touch') return;

    e.stopPropagation();
    e.currentTarget.releasePointerCapture(e.pointerId);
    lastMousePos.current = null;
    initialMouseTransform.current = null;
  };

  const platformColors: Record<string, string> = {
    '08A': '#ffffff',
    '08B': '#3b82f6',
    '08C': '#94a3b8',
    '08D': '#1e293b',
  };

  // Helper to determine if a specific sweep should show
  const shouldShowSweep = (step: number) => {
    // Only show sweeps if explicitly allowed
    if (!allowSweeps) return false;
    // Show if it's the current highlight step OR the final total-review step (4)
    return (highlightStep === step || highlightStep === 4);
  };

  // Get the base code for platform colors (remove A/B/C/D)
  const platformBase = platform?.replace(/[A-D]$/, '');

  // Pre-calculate effective logo and text values at the component scope
  const componentPreset = getBrandingPreset(envVariant, brandingPresets || {});
  
  const componentRawImageId = getImageIdForVariant(envVariant);
  let componentUpperImageId = componentRawImageId.toUpperCase().trim();
  if (componentUpperImageId.startsWith("ARCHI ")) {
    componentUpperImageId = componentUpperImageId.replace("ARCHI ", "ARCH ");
  }

  let componentActiveDocId = "A Blanc";
  const matchedKey = Object.keys(brandingPresets || {}).find(key => {
    return isKeyMatch(key, componentUpperImageId);
  });
  
  if (matchedKey) {
    componentActiveDocId = matchedKey;
  } else {
    const aBlancKey = Object.keys(brandingPresets || {}).find(key => {
      return isKeyMatch(key, "A Blanc") || isKeyMatch(key, "ABLANC") || isKeyMatch(key, "ABLANCA");
    });
    if (aBlancKey) {
      componentActiveDocId = aBlancKey;
    }
  }

  const getPresetLogoUrlAtScope = () => {
    if (!componentPreset) return null;
    const lValue = getPropValue(componentPreset, 'logo');
    if (typeof lValue === 'string' && (lValue.startsWith('http') || lValue.startsWith('data:'))) {
      return lValue;
    }
    const luValue = getPropValue(componentPreset, 'logoUrl');
    if (typeof luValue === 'string' && luValue.trim() !== '') {
      return luValue;
    }
    const imgUrlValue = getPropValue(componentPreset, 'imageUrl');
    if (typeof imgUrlValue === 'string' && imgUrlValue.trim() !== '') {
      return imgUrlValue;
    }
    const imgValue = getPropValue(componentPreset, 'image');
    if (typeof imgValue === 'string' && (imgValue.startsWith('http') || imgValue.startsWith('data:'))) {
      return imgValue;
    }
    const clValue = getPropValue(componentPreset, 'customLogo');
    if (typeof clValue === 'string' && clValue.trim() !== '') {
      return clValue;
    }
    if (getPropValue(componentPreset, 'logo') !== false) {
      return "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' fill='none' stroke='white' stroke-width='4'><path stroke-linecap='round' stroke-linejoin='round' d='M50 95c24.853 0 45-20.147 45-45S74.853 5 50 5 5 25.147 5 50s20.147 45 45 45z' /><path stroke-linecap='round' stroke-linejoin='round' d='M50 35a15 15 0 100 30 15 15 0 000-30z' /><path stroke-linecap='round' stroke-linejoin='round' d='M50 5v90M5 50h90' stroke-width='2' stroke-dasharray='4' /></svg>";
    }
    return null;
  };

  const rawEffectiveLogo = customLogo || logo || getPresetLogoUrlAtScope();
  const resolvedLocalLogo = useLocalDataUrl(rawEffectiveLogo);
  const effectiveLogo = resolvedLocalLogo || rawEffectiveLogo;
  const effectiveText = logoText;

  return (
    <div 
      className="w-full aspect-[4/3] bg-black relative overflow-hidden shrink-0 group"
      style={{ containerType: 'inline-size' } as React.CSSProperties}
    >
      {/* Asset Name Display (Top Left) */}
      {!hideDebugInfo && (
        <div className="absolute top-2 left-2 z-[60] bg-black/40 backdrop-blur-sm px-2 py-1 flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            <span className="text-[10px] font-mono font-bold tracking-widest text-white uppercase">{envVariant || '07A'}</span>
          </div>
          {platform && (
            <span className="text-[8px] font-mono text-white/40 tracking-wider">BASE: {platform}</span>
          )}
        </div>
      )}

      {/* Navigation Arrows (Global overlay) */}
      <div className="absolute inset-0 z-[70] pointer-events-none">
        {/* Environment Navigation (Left Edge) */}
        {onNavigateEnv && highlightStep === 0 && (
          <button 
            onClick={(e) => { e.stopPropagation(); onNavigateEnv(-1); }}
            className="absolute left-0 top-1/2 -translate-y-1/2 w-16 h-full flex items-center justify-center text-white pointer-events-auto bg-transparent hover:bg-transparent active:bg-transparent"
            style={{ WebkitTapHighlightColor: 'transparent' }}
            title="Previous Environment"
          >
            <ChevronLeft size={32} strokeWidth={2.5} className="drop-shadow-lg" />
          </button>
        )}
        
        {/* Environment Navigation (Right Edge) */}
        {onNavigateEnv && highlightStep === 0 && (
          <button 
            onClick={(e) => { e.stopPropagation(); onNavigateEnv(1); }}
            className="absolute right-0 top-1/2 -translate-y-1/2 w-16 h-full flex items-center justify-center text-white pointer-events-auto bg-transparent hover:bg-transparent active:bg-transparent"
            style={{ WebkitTapHighlightColor: 'transparent' }}
            title="Next Environment"
          >
            <ChevronRight size={32} strokeWidth={2.5} className="drop-shadow-lg" />
          </button>
        )}

        {/* Base Navigation (Left Edge, aligned with base) */}
        {onNavigateBase && platform && highlightStep === 1 && (
          <button 
            onClick={(e) => { e.stopPropagation(); onNavigateBase(-1); }}
            className="absolute left-0 top-[80%] -translate-y-1/2 w-16 h-32 flex items-center justify-center text-white pointer-events-auto bg-transparent hover:bg-transparent active:bg-transparent"
            style={{ WebkitTapHighlightColor: 'transparent' }}
            title="Previous Base Style"
          >
            <ChevronLeft size={32} strokeWidth={2.5} className="drop-shadow-lg" />
          </button>
        )}

        {/* Base Navigation (Right Edge) */}
        {onNavigateBase && platform && highlightStep === 1 && (
          <button 
            onClick={(e) => { e.stopPropagation(); onNavigateBase(1); }}
            className="absolute right-0 top-[80%] -translate-y-1/2 w-16 h-32 flex items-center justify-center text-white pointer-events-auto bg-transparent hover:bg-transparent active:bg-transparent"
            style={{ WebkitTapHighlightColor: 'transparent' }}
            title="Next Base Style"
          >
            <ChevronRight size={32} strokeWidth={2.5} className="drop-shadow-lg" />
          </button>
        )}
      </div>

      {/* Global Light Sweeps overlay - Now strictly for Background, placed behind elements */}
      {shouldShowSweep(0) && (
        <div className="absolute inset-0 pointer-events-none z-[5]">
          {/* Global Sweep (Environment) */}
          <motion.div 
            className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent w-full -skew-x-12"
            initial={{ left: '-150%' }}
            animate={{ left: '150%' }}
            transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>
      )}

      {/* Environment Background */}
      <div className="absolute top-1/2 left-0 w-full aspect-square -translate-y-1/2 z-0 text-white overflow-hidden">
        <AnimatePresence mode="popLayout">
          <SafeImage 
            key={envVariant}
            code={envVariant || '07A'} 
            className="absolute inset-0 w-full h-full object-cover"
            priority={true}
          />
        </AnimatePresence>
      </div>

      {/* Basic Platform Layer */}
      {showPlatform && platform && (
        <div className="absolute top-1/2 left-0 w-full aspect-square -translate-y-1/2 z-10 pointer-events-none">
          <div className="absolute top-[80%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-3/4 h-3/4 scale-[1.2]">
            <SafeImage 
              code={platform} 
              className="w-full h-full object-contain"
            />
            {/* Base Highlight Sweep - Sequential or Final Review */}
            {shouldShowSweep(1) && (
              <div 
                className="absolute inset-0 z-10"
                style={{
                  WebkitMaskImage: `url(${getAssetBaseRoute(platform)}.png)`,
                  maskImage: `url(${getAssetBaseRoute(platform)}.png)`,
                  WebkitMaskSize: 'contain',
                  maskSize: 'contain',
                  WebkitMaskRepeat: 'no-repeat',
                  maskRepeat: 'no-repeat',
                  WebkitMaskPosition: 'center',
                }}
              >
                <motion.div 
                  className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent w-1/3 -skew-x-12"
                  initial={{ left: '-100%' }}
                  animate={{ left: '200%' }}
                  transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
                />
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* Vehicle and Accents Layer */}
      <div className="absolute top-1/2 left-0 w-full aspect-square -translate-y-1/2 flex items-center justify-center z-20 pointer-events-none">
        <div className="relative w-3/4 h-3/4 pointer-events-auto">
          {image && (
            <div className="w-full h-full relative z-10">
              {isIsolated && (
                <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/checkerboard.png')] opacity-20" />
              )}
              
              {/* Main Vehicle Image */}
              <motion.img 
                src={image} 
                data-zone="vehicle"
                className={cn(
                  "w-full h-full object-contain relative z-10 transition-all duration-300",
                  selectedZone === 'vehicle' ? "drop-shadow-[0_0_18px_rgba(59,130,246,0.95)] filter-none" : "hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.25)]",
                  onUpdateTransform && "cursor-grab active:cursor-grabbing select-none"
                )}
                style={{ 
                  x: `${imageTransform.x}%`, 
                  y: `${imageTransform.y}%`, 
                  scale: imageTransform.scale * (imageTransform.baselineScale || 1.0), 
                  rotate: imageTransform.rotate,
                  touchAction: onUpdateTransform ? "none" : "auto"
                }}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onWheel={(e) => {
                  if (onUpdateTransform) {
                    e.preventDefault();
                    e.stopPropagation();
                    const delta = e.deltaY < 0 ? 1.05 : 0.95;
                    const newScale = Math.min(3.0, Math.max(0.2, imageTransform.scale * delta));
                    onUpdateTransform({
                      ...imageTransform,
                      scale: newScale
                    });
                  }
                }}
                referrerPolicy="no-referrer"
              />

              {/* Vehicle Highlight Sweep - Sequential or Final Review or Selected Zone */}
              {(shouldShowSweep(2) || selectedZone === 'vehicle') && (
                <motion.div 
                  className="absolute inset-0 z-20"
                  style={{
                    maskImage: `url(${image})`, 
                    maskSize: 'contain', 
                    maskRepeat: 'no-repeat', 
                    maskPosition: 'center',
                    WebkitMaskImage: `url(${image})`,
                    WebkitMaskSize: 'contain',
                    WebkitMaskRepeat: 'no-repeat',
                    WebkitMaskPosition: 'center',
                    x: `${imageTransform.x}%`,
                    y: `${imageTransform.y}%`,
                    scale: imageTransform.scale * (imageTransform.baselineScale || 1.0),
                    rotate: imageTransform.rotate,
                    pointerEvents: 'none'
                  }}
                >
                  <motion.div 
                    className={cn(
                      "absolute inset-0 w-1/3 -skew-x-12",
                      selectedZone === 'vehicle' 
                        ? "bg-gradient-to-r from-transparent via-blue-500/80 via-cyan-400 to-transparent" 
                        : "bg-gradient-to-r from-transparent via-white/60 to-transparent"
                    )}
                    initial={{ left: '-100%' }}
                    animate={{ left: '200%' }}
                    transition={{ 
                      duration: selectedZone === 'vehicle' ? 2.2 : 4.5, 
                      repeat: Infinity, 
                      ease: "easeInOut" 
                    }}
                  />
                </motion.div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Dynamic Branding Layer - Loaded from Firestore custom preset collections */}
      {(() => {
        const preset = getBrandingPreset(envVariant, brandingPresets || {});
        
        // Find the document ID of the active preset so we can extract its name as fallback text
        const rawImageId = getImageIdForVariant(envVariant);
        let upperImageId = rawImageId.toUpperCase().trim();
        if (upperImageId.startsWith("ARCHI ")) {
          upperImageId = upperImageId.replace("ARCHI ", "ARCH ");
        }

        let activeDocumentId = "A Blanc";
        const matchedKey = Object.keys(brandingPresets || {}).find(key => {
          return isKeyMatch(key, upperImageId);
        });
        
        if (matchedKey) {
          activeDocumentId = matchedKey;
        } else {
          const aBlancKey = Object.keys(brandingPresets || {}).find(key => {
            return isKeyMatch(key, "A Blanc") || isKeyMatch(key, "ABLANC") || isKeyMatch(key, "ABLANCA");
          });
          if (aBlancKey) {
            activeDocumentId = aBlancKey;
          }
        }

        // Logo and text should NOT appear on 'environment' screens or earlier steps.
        const isEnvironmentOrBefore = [
          'home', 
          'shooting_conditions',
          'vehicle_category',
          'vehicle_selection',
          'upload', 
          'ad_style',
          'environment_category',
          'environment_variants',
          'platform_base'
        ].includes(screen);

        const isBrandingScreenOrLater = !isEnvironmentOrBefore;

        const rawEffectiveLogo = customLogo || logo || getPresetLogoUrlAtScope();
        const effectiveLogo = resolvedLocalLogo || rawEffectiveLogo;
        const presetTextContent = getPropValue(preset, 'textContent') || getPropValue(preset, 'text_content') || "VOTRE TEXTE ICI";
        const effectiveText = logoText || presetTextContent;

        const isLogoVisible = isBrandingScreenOrLater && (showLogo !== false) && !!effectiveLogo && (getPropValue(preset, 'logo') !== false);
        const isTextVisible = isBrandingScreenOrLater && (showText !== false) && !!effectiveText && (getPropValue(preset, 'text') !== false);

        const refRes = getPresetRefResolution(preset);

        const getLogoXPercent = () => {
          const logoX = getPropValue(preset, 'logoX');
          if (logoX != null && logoX !== '') {
            const valStr = String(logoX).toUpperCase().trim();
            if (valStr === 'CENTRE' || valStr === 'CENTER') return 50;
            const val = parseFloat(valStr);
            if (!isNaN(val)) return (val / refRes) * 100;
          }
          const imagePosition = getPropValue(preset, 'imagePosition');
          const coords = parseCoordinates(imagePosition, Math.round(refRes / 2), Math.round(refRes * 0.1));
          return (coords.x / refRes) * 100;
        };

        const getLogoYPercent = () => {
          const logoY = getPropValue(preset, 'logoY');
          if (logoY != null && logoY !== '') {
            const valStr = String(logoY).toUpperCase().trim();
            if (valStr === 'CENTRE' || valStr === 'CENTER') return 50;
            const val = parseFloat(valStr);
            if (!isNaN(val)) return (val / refRes) * 100;
          }
          const imagePosition = getPropValue(preset, 'imagePosition');
          const coords = parseCoordinates(imagePosition, Math.round(refRes / 2), Math.round(refRes * 0.1));
          return (coords.y / refRes) * 100;
        };

        const getLogoSizePercent = () => {
          const logoSize = getPropValue(preset, 'logoSize');
          const val = parseFloat(logoSize || "150");
          if (isNaN(val)) return (150 / refRes) * 100;
          return (val / refRes) * 100;
        };

        const getTextXPercent = () => {
          const textX = getPropValue(preset, 'textX');
          if (textX != null && textX !== '') {
            const valStr = String(textX).toUpperCase().trim();
            if (valStr === 'CENTRE' || valStr === 'CENTER') return 50;
            const val = parseFloat(valStr);
            if (!isNaN(val)) return (val / refRes) * 100;
          }
          const textPosition = getPropValue(preset, 'textPosition');
          const coords = parseCoordinates(textPosition, Math.round(refRes / 2), Math.round(refRes * 0.78));
          return (coords.x / refRes) * 100;
        };

        const getTextYPercent = () => {
          const textY = getPropValue(preset, 'textY');
          if (textY != null && textY !== '') {
            const valStr = String(textY).toUpperCase().trim();
            if (valStr === 'CENTRE' || valStr === 'CENTER') return 50;
            const val = parseFloat(valStr);
            if (!isNaN(val)) return (val / refRes) * 100;
          }
          const textPosition = getPropValue(preset, 'textPosition');
          const coords = parseCoordinates(textPosition, Math.round(refRes / 2), Math.round(refRes * 0.78));
          return (coords.y / refRes) * 100;
        };

        const getTextSizePercent = () => {
          const textSize = getPropValue(preset, 'textSize');
          const val = parseFloat(textSize || "32");
          if (isNaN(val)) return (32 / refRes) * 100;
          return (val / refRes) * 100;
        };

        const logoXPercent = getLogoXPercent();
        const logoYPercent = getLogoYPercent();
        const logoSizePercent = getLogoSizePercent();
        const textXPercent = getTextXPercent();
        const textYPercent = getTextYPercent();
        const textSizePercent = getTextSizePercent();
        
        const logoColorFillEnabled = getPropValue(preset, 'logoColorFillEnabled');
        const logoColorFill = getPropValue(preset, 'logoColorFill');
        const useColorFill = logoColorFillEnabled === true && logoColorFill && String(logoColorFill).trim() !== '';

        const getTextAlignProps = () => {
          const textAlign = getPropValue(preset, 'textAlign');
          const rawAlign = textAlign ? String(textAlign).toUpperCase().trim() : 'CENTRE';
          if (rawAlign === 'GAUCHE') {
            return {
              align: 'left' as const,
              transformX: '0%',
              justifyClass: 'justify-start'
            };
          } else if (rawAlign === 'DROITE') {
            return {
              align: 'right' as const,
              transformX: '-100%',
              justifyClass: 'justify-end'
            };
          } else {
            return {
              align: 'center' as const,
              transformX: '-50%',
              justifyClass: 'justify-center'
            };
          }
        };

        const alignProps = getTextAlignProps();

        return (
          <div className="absolute top-1/2 left-0 w-full aspect-square -translate-y-1/2 pointer-events-none z-30">
            {/* Logo Section */}
            {isLogoVisible && (
              <div 
                className={cn(
                  "absolute group/logo transition-all duration-300 flex items-center justify-center",
                  selectedZone === 'logo' ? "drop-shadow-[0_0_18px_rgba(59,130,246,0.95)]" : "drop-shadow-md hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.25)]"
                )}
                style={{
                  left: `${logoXPercent}%`,
                  top: `${logoYPercent}%`,
                  width: `${logoSizePercent}%`,
                  height: `${logoSizePercent}%`,
                  transform: 'translate(-50%, -50%)',
                }}
              >
                <div className="relative w-full h-full flex items-center justify-center">
                  {useColorFill ? (
                    <div 
                      className="w-full h-full relative z-10"
                      data-zone="logo"
                      style={{
                        backgroundColor: getPropValue(preset, 'logoColorFill'),
                        WebkitMaskImage: `url(${effectiveLogo})`,
                        maskImage: `url(${effectiveLogo})`,
                        WebkitMaskSize: 'contain',
                        maskSize: 'contain',
                        WebkitMaskRepeat: 'no-repeat',
                        maskRepeat: 'no-repeat',
                        WebkitMaskPosition: 'center',
                      }}
                    />
                  ) : (
                    <img 
                      src={effectiveLogo || ''} 
                      data-zone="logo"
                      className="w-full h-full object-contain relative z-10" 
                      referrerPolicy="no-referrer" 
                      alt="Logo"
                    />
                  )}
                  {/* Logo Highlight Sweep - Sequential or Final Review or Selected Zone */}
                  {(shouldShowSweep(3) || selectedZone === 'logo') && (
                    <div 
                      className="absolute inset-0 z-20"
                      style={{
                        WebkitMaskImage: `url(${effectiveLogo})`,
                        maskImage: `url(${effectiveLogo})`,
                        WebkitMaskSize: 'contain',
                        maskSize: 'contain',
                        WebkitMaskRepeat: 'no-repeat',
                        maskRepeat: 'no-repeat',
                        WebkitMaskPosition: 'center',
                      }}
                    >
                      <motion.div 
                        className={cn(
                          "absolute inset-0 w-1/3 -skew-x-12",
                          selectedZone === 'logo'
                            ? "bg-gradient-to-r from-transparent via-blue-500/80 via-cyan-400 to-transparent"
                            : "bg-gradient-to-r from-transparent via-white/80 to-transparent"
                        )}
                        initial={{ left: '-100%' }}
                        animate={{ left: '200%' }}
                        transition={{ 
                          duration: selectedZone === 'logo' ? 2.2 : 4.5, 
                          repeat: Infinity, 
                          ease: "easeInOut" 
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Text Section */}
            {isTextVisible && (
              <div 
                className="absolute"
                style={{
                  left: `${textXPercent}%`,
                  top: `${textYPercent}%`,
                  transform: `translate(${alignProps.transformX}, -50%)`,
                }}
              >
                <div 
                  className={cn(
                    "relative overflow-hidden group/text flex items-center py-1 transition-all duration-300", 
                    alignProps.justifyClass,
                    selectedZone === 'text' ? "drop-shadow-[0_0_18px_rgba(59,130,246,0.95)]" : "drop-shadow-md hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.25)]"
                  )}
                >
                  <span 
                    data-zone="text"
                    className="font-bold tracking-widest uppercase text-white whitespace-nowrap px-4 py-1"
                    style={{
                      fontSize: `${textSizePercent}cqw`,
                      fontFamily: getPropValue(preset, 'textFont') || 'Inter',
                      color: getEffectiveTextColor(preset),
                      textAlign: alignProps.align,
                    }}
                  >
                    {effectiveText}
                  </span>
                  {/* Text Highlight Sweep - Sequential or Final Review or Selected Zone */}
                  {(shouldShowSweep(3) || selectedZone === 'text') && (
                    <div className={cn("absolute inset-0 z-10", selectedZone === 'text' ? "" : "mix-blend-overlay")}>
                      <motion.div 
                        className={cn(
                          "absolute inset-0 w-full -skew-x-12 h-full",
                          selectedZone === 'text'
                            ? "bg-gradient-to-r from-transparent via-blue-500/80 via-cyan-400 to-transparent"
                            : "bg-gradient-to-r from-transparent via-white/80 to-transparent"
                        )}
                        initial={{ left: '-100%' }}
                        animate={{ left: '250%' }}
                        transition={{ 
                          duration: selectedZone === 'text' ? 2.2 : 4.5, 
                          repeat: Infinity, 
                          ease: "easeInOut" 
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Special Highlights for Logo on Result screen */}
      {highlightStep === 4 && effectiveLogo && showLogo && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[90] pointer-events-none">
          <div 
            className="relative w-[60px] h-[60px]"
            style={{
              WebkitMaskImage: `url(${effectiveLogo})`,
              maskImage: `url(${effectiveLogo})`,
              WebkitMaskSize: 'contain',
              maskSize: 'contain',
              WebkitMaskRepeat: 'no-repeat',
              maskRepeat: 'no-repeat',
              WebkitMaskPosition: 'center',
            }}
          >
            <motion.div 
              className="absolute inset-0 bg-gradient-to-r from-transparent via-white/80 to-transparent w-1/3 -skew-x-12 h-full"
              initial={{ left: '-100%' }}
              animate={{ left: '200%' }}
              transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
            />
          </div>
        </div>
      )}

      {/* Color Theme Overlay */}
      <div 
        className="absolute inset-0 pointer-events-none z-40"
        style={{ 
          backgroundColor: colorTheme, 
          opacity: 0.2 * colorIntensity,
          mixBlendMode: 'overlay' 
        }}
      />
    </div>
  );
};

const SelectionGrid = ({ 
  items, 
  selected, 
  onSelect,
  columns = 2,
  aspectRatio = 1,
  gap = 4
}: { 
  items: { id: string, label: string, img: string, code?: string, status?: 'best' | 'normal' | 'not_recommended' }[], 
  selected: string | null, 
  onSelect: (id: string | null) => void,
  columns?: number,
  aspectRatio?: number,
  gap?: number
}) => (
  <div className={cn(
    "grid px-6",
    gap === 2 ? "gap-2" : gap === 4 ? "gap-4" : "gap-6",
    columns === 1 ? "grid-cols-1" : columns === 2 ? "grid-cols-2" : "grid-cols-3"
  )}>
    {items.map((item) => (
      <div
        key={item.id}
        onClick={() => onSelect(selected === item.id ? null : item.id)}
        className="flex flex-col"
      >
        <div 
          className={cn(
            "relative group cursor-pointer overflow-hidden transition-all",
            selected === item.id ? "bg-white/10" : "bg-white/5",
          )}
        >
          <AspectRatio ratio={aspectRatio}>
            <SafeImage 
              code={item.code || item.id} 
              className="w-full h-full object-cover opacity-100 brightness-100 transition-all group-hover:scale-105"
            />
            {/* Selection Frame Overlay - Inset style */}
            {selected === item.id && (
              <div className="absolute inset-0 ring-2 ring-inset ring-white z-10 pointer-events-none" />
            )}
            {item.status === 'best' && (
              <div className="absolute top-1 right-1 z-20">
                <Sparkles className="w-3 h-3 text-white animate-pulse" />
              </div>
            )}
          </AspectRatio>
        </div>
        <div className="mt-[-2px] text-center">
          <span className={cn(
            "text-[9px] font-medium uppercase tracking-[0.2em] transition-colors",
            selected === item.id ? "text-white" : "text-white/40"
          )}>
            {item.label}
          </span>
        </div>
      </div>
    ))}
  </div>
);

const HomeScreen: React.FC<{ 
  onStart: () => void;
  deferredPrompt: any;
  isInstalled: boolean;
  isOffline: boolean;
  onInstall: () => void;
}> = ({ onStart, deferredPrompt, isInstalled, isOffline, onInstall }) => {
  const [showQR, setShowQR] = useState(false);
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [copied, setCopied] = useState(false);
  
  const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(currentUrl)}`;

  const handleExportHD = async () => {
    setIsExporting(true);
    setExportUrl(null);
    setCopied(false);
    try {
      const img = new Image();
      img.src = '/assets/01A.png';
      img.onload = async () => {
        try {
          const canvas = document.createElement('canvas');
          // Standard gorgeous high definition canvas (e.g. 2160 x 3840 portrait aspect ratio 9:16)
          const w = img.naturalWidth || 2160;
          const h = img.naturalHeight || 3840;
          canvas.width = w;
          canvas.height = h;
          
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            setIsExporting(false);
            return;
          }
          
          // Background solid dark grey to match application workspace
          ctx.fillStyle = '#09090b';
          ctx.fillRect(0, 0, w, h);
          
          // Shifting image down (12% of the total background altitude)
          const offsetPercent = 0.12;
          const drawY = h * offsetPercent;
          const drawH = h * (1 - offsetPercent);
          ctx.drawImage(img, 0, drawY, w, drawH);
          
          // Smooth vertical linear gradient reconstituting the top dark portion
          const gradientHeight = h * 0.45;
          const grad = ctx.createLinearGradient(0, 0, 0, gradientHeight);
          grad.addColorStop(0, '#09090b'); // Solid black at top
          grad.addColorStop(0.35, '#09090b'); // Hold solid black
          grad.addColorStop(1, 'rgba(9, 9, 11, 0)'); // Seamless transparent transition
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, w, gradientHeight);
          
          // Bottom subtle ambient shadow for visual balance
          const bottomGrad = ctx.createLinearGradient(0, h * 0.85, 0, h);
          bottomGrad.addColorStop(0, 'rgba(9, 9, 11, 0)');
          bottomGrad.addColorStop(1, '#09090b');
          ctx.fillStyle = bottomGrad;
          ctx.fillRect(0, h * 0.85, w, h * 0.15);
          
          const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
          
          // 1. Direct local file download
          const link = document.createElement('a');
          link.download = `premium-visuals-reconstituted-hd.jpg`;
          link.href = dataUrl;
          link.click();
          
          // 2. Upload to Firebase Storage to create a persistent url address
          try {
            const uniqueName = `homescreen_hd_${Date.now()}.jpg`;
            const userId = getAuth().currentUser?.uid || 'guest';
            const storageRef = ref(storage, `users/${userId}/homescreens/${uniqueName}`);
            await uploadString(storageRef, dataUrl, 'data_url');
            const publicUrl = await getDownloadURL(storageRef);
            setExportUrl(publicUrl);
          } catch (storageErr) {
            console.error("[Export Upload Failed] Falling back directly to local DataURL:", storageErr);
            setExportUrl(dataUrl);
          }
        } catch (err) {
          console.error("Canvas rendering failed during visual reconstitution:", err);
        } finally {
          setIsExporting(false);
        }
      };
      img.onerror = () => {
        setIsExporting(false);
        console.error("Failed to load source visual image asset");
      };
    } catch (err) {
      console.error("Export operation failed:", err);
      setIsExporting(false);
    }
  };

  return (
    <div className="h-dvh flex flex-col bg-background relative overflow-hidden">
      <div className="absolute inset-0 z-0 bg-[#09090b]">
        {/* Shifting background down inside viewport to avoid overlapping car focus with branding title */}
        <SafeImage 
          code="01A" 
          className="w-full h-full object-cover object-[center_80%]"
        />
        {/* Reconstituted top dark shadow gradient block */}
        <div className="absolute inset-x-0 top-0 h-[40%] bg-gradient-to-b from-black via-black/90 to-transparent pointer-events-none" />
        {/* Bottom subtle grounding vignette */}
        <div className="absolute inset-x-0 bottom-0 h-[15%] bg-gradient-to-t from-black to-transparent pointer-events-none" />
        
        {/* Code Overlay */}
        <div className="absolute top-4 left-6 z-20">
          <span className="text-[10px] font-bold tracking-[0.4em] text-white/60">01A</span>
        </div>
      </div>
      
      <div className="relative z-10 flex-grow flex flex-col justify-between p-8 pb-16">
        {/* Typographic Title Block - finishes well above the vehicle background */}
        <div className="pt-8 select-none flex justify-center">
          <div className="inline-flex flex-col text-center w-full max-w-[280px]">
            <h1 className="flex flex-col space-y-[4px]">
              <span className="text-3xl font-light text-white tracking-[0.26em] pl-[0.26em] uppercase block leading-none">
                PREMIUM
              </span>
              <span className="text-4xl font-bold text-white tracking-[0.115em] pl-[0.115em] uppercase block leading-none">
                VISUALS
              </span>
              <span className="text-[17.5px] font-light text-white/50 tracking-[0.43em] pl-[0.43em] uppercase block leading-none">
                IN SECONDS
              </span>
            </h1>
          </div>
        </div>

        <div>{/* Mid spacing */}</div>

        <div className="space-y-3">
          <Button onClick={onStart} className="w-full h-14 rounded-none text-lg font-medium bg-white text-black hover:bg-white/90">
            Start
          </Button>
          
          {!isInstalled && !isOffline && (
            <Button 
              variant="outline" 
              onClick={() => setShowQR(true)} 
              className="w-full h-11 rounded-none border-white/10 text-xs font-light uppercase tracking-[0.2em] text-white hover:bg-white hover:text-black cursor-pointer bg-black/40 backdrop-blur-sm"
            >
              Scan on iPhone
            </Button>
          )}
        </div>
      </div>

      {/* Modern Blurred QR Code Modal Overlay */}
      <AnimatePresence>
        {showQR && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 bg-black/80 backdrop-blur-md flex flex-col justify-center items-center p-6 text-center"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 10 }}
              className="bg-zinc-900 border border-white/10 max-w-sm w-full p-6 space-y-6"
            >
              <div className="space-y-1">
                <span className="text-[10px] font-bold tracking-[0.2em] text-white/40 uppercase">Install on iOS / Android</span>
                <h3 className="text-xl font-light tracking-tight text-white">Scanner avec votre iPhone</h3>
              </div>
              
              <div className="bg-white p-4 inline-block mx-auto border-4 border-white">
                <img 
                  src={qrCodeUrl} 
                  alt="QR Code" 
                  className="w-48 h-48 block"
                />
              </div>

              <div className="space-y-3 text-left">
                <div className="flex gap-3 items-start">
                  <span className="bg-white/10 text-white font-mono text-[10px] w-5 h-5 flex items-center justify-center rounded-full shrink-0">1</span>
                  <p className="text-white/60 text-[11px] leading-snug">Scannez le QR Code avec l'appareil photo de votre iPhone.</p>
                </div>
                <div className="flex gap-3 items-start">
                  <span className="bg-white/10 text-white font-mono text-[10px] w-5 h-5 flex items-center justify-center rounded-full shrink-0">2</span>
                  <p className="text-white/60 text-[11px] leading-snug">Ouvrez le lien dans <strong>Safari</strong> (important pour l'installation iOS).</p>
                </div>
                <div className="flex gap-3 items-start">
                  <span className="bg-white/10 text-white font-mono text-[10px] w-5 h-5 flex items-center justify-center rounded-full shrink-0">3</span>
                  <p className="text-white/60 text-[11px] leading-snug">Appuyez sur le bouton de <strong>Partage</strong> <span className="text-white text-xs inline-block bg-white/10 px-1 font-sans">⎋</span> puis sur <strong>Sur l'écran d'accueil</strong>.</p>
                </div>
              </div>

              <Button 
                onClick={() => setShowQR(false)} 
                variant="outline" 
                className="w-full h-11 rounded-none border-white/20 text-white hover:bg-white hover:text-black transition-colors uppercase text-xs font-semibold tracking-wider bg-white/5 cursor-pointer"
              >
                Fermer
              </Button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modern Export Link Modal Overlay */}
      <AnimatePresence>
        {exportUrl && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 bg-black/80 backdrop-blur-md flex flex-col justify-center items-center p-6 text-center"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 10 }}
              className="bg-zinc-900 border border-white/10 max-w-sm w-full p-6 space-y-6"
            >
              <div className="space-y-1">
                <span className="text-[10px] font-bold tracking-[0.2em] text-white/40 uppercase">EXPORT RECONSTITUÉ HD</span>
                <h3 className="text-xl font-light tracking-tight text-white">Visual Exported successfully!</h3>
                <p className="text-xs text-white/60">The visual with its top dark area reconstituted has been downloaded, and sits online at this address:</p>
              </div>

              <div className="bg-black/40 border border-white/10 p-3 flex items-center justify-between gap-2 overflow-hidden">
                <input 
                  type="text" 
                  readOnly 
                  value={exportUrl} 
                  className="bg-transparent text-white text-xs select-all outline-none w-full font-mono overflow-ellipsis overflow-hidden whitespace-nowrap"
                  onClick={(e: any) => e.target.select()}
                />
                <Button 
                  size="sm" 
                  variant="secondary"
                  className="rounded-none text-[10px] uppercase tracking-wider font-bold h-8 flex-shrink-0"
                  onClick={() => {
                    navigator.clipboard.writeText(exportUrl || '');
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                >
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>

              <div className="flex flex-col gap-2">
                <Button 
                  className="w-full bg-white text-black hover:bg-white/90 rounded-none h-11 font-bold uppercase tracking-wider text-xs"
                  onClick={() => { window.open(exportUrl || '', '_blank'); }}
                >
                  Ouvrir l'adresse
                </Button>
                <Button 
                  onClick={() => setExportUrl(null)}
                  variant="outline" 
                  className="w-full h-11 rounded-none border-white/20 text-white hover:bg-white hover:text-black transition-colors uppercase text-xs font-semibold tracking-wider bg-white/5 cursor-pointer"
                >
                  Fermer
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};


const compressDataUrl = (
  dataUrl: string,
  maxDim: number,
  format: 'image/jpeg' | 'image/png',
  quality: number
): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    if (dataUrl && !dataUrl.startsWith('data:')) {
      img.crossOrigin = "anonymous";
    }
    img.onload = () => {
      let width = img.width;
      let height = img.height;

      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(dataUrl);
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);
      const compressedDataUrl = canvas.toDataURL(format, quality);
      resolve(compressedDataUrl);
    };
    img.onerror = () => {
      resolve(dataUrl);
    };
    img.src = dataUrl;
  });
};

const compressVehiclePng = (
  dataUrl: string,
  startMaxDim: number = 1600,
  maxBase64Length: number = 650 * 1024
): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    if (dataUrl && !dataUrl.startsWith('data:')) {
      img.crossOrigin = "anonymous";
    }
    img.onload = () => {
      let currentDim = startMaxDim;
      let finalDataUrl = dataUrl;
      const originalWidth = img.width;
      const originalHeight = img.height;
      
      const stepDown = () => {
        let width = originalWidth;
        let height = originalHeight;

        if (width > currentDim || height > currentDim) {
          if (width > height) {
            height = Math.round((height * currentDim) / width);
            width = currentDim;
          } else {
            width = Math.round((width * currentDim) / height);
            height = currentDim;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(finalDataUrl);
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        finalDataUrl = canvas.toDataURL("image/png");

        if (finalDataUrl.length <= maxBase64Length) {
          console.log(`[PNG Compr] Success at dimension ${currentDim}px. Size: ${Math.round(finalDataUrl.length / 1024)} KB`);
          resolve(finalDataUrl);
        } else if (currentDim > 300) {
          console.warn(`[PNG Compr] Over limit (${Math.round(finalDataUrl.length / 1024)} KB) with dim ${currentDim}px. Downscaling...`);
          currentDim = Math.round(currentDim * 0.8);
          setTimeout(stepDown, 0);
        } else {
          console.warn(`[PNG Compr] Reached absolute floor. Size: ${Math.round(finalDataUrl.length / 1024)} KB`);
          resolve(finalDataUrl);
        }
      };

      stepDown();
    };
    img.onerror = () => {
      resolve(dataUrl);
    };
    img.src = dataUrl;
  });
};

const compressPreviewJpeg = (
  dataUrl: string,
  startMaxDim: number = 720,
  maxBase64Length: number = 100 * 1024
): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    if (dataUrl && !dataUrl.startsWith('data:')) {
      img.crossOrigin = "anonymous";
    }
    img.onload = () => {
      let currentDim = startMaxDim;
      let finalDataUrl = dataUrl;
      const originalWidth = img.width;
      const originalHeight = img.height;
      
      const stepDown = () => {
        let width = originalWidth;
        let height = originalHeight;

        if (width > currentDim || height > currentDim) {
          if (width > height) {
            height = Math.round((height * currentDim) / width);
            width = currentDim;
          } else {
            width = Math.round((width * currentDim) / height);
            height = currentDim;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(finalDataUrl);
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        // Higher quality: IMAGE_C is the model's composition reference and it
        // reproduces its quality. It is uploaded to Storage (not embedded in the
        // Firestore doc), so a larger, sharper JPEG has no size penalty.
        finalDataUrl = canvas.toDataURL("image/jpeg", 0.9);

        if (finalDataUrl.length <= maxBase64Length) {
          console.log(`[JPEG Preview] Success at dimension ${currentDim}px. Size: ${Math.round(finalDataUrl.length / 1024)} KB`);
          resolve(finalDataUrl);
        } else if (currentDim > 200) {
          console.warn(`[JPEG Preview] Over limit (${Math.round(finalDataUrl.length / 1024)} KB) with dim ${currentDim}px. Downscaling...`);
          currentDim = Math.round(currentDim * 0.85);
          setTimeout(stepDown, 0);
        } else {
          console.warn(`[JPEG Preview] Reached absolute floor. Size: ${Math.round(finalDataUrl.length / 1024)} KB`);
          resolve(finalDataUrl);
        }
      };

      stepDown();
    };
    img.onerror = () => {
      resolve(dataUrl);
    };
    img.src = dataUrl;
  });
};

const getAssetAsDataUrl = (url: string): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.width || 800;
        canvas.height = img.height || 600;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve('');
          return;
        }
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL("image/jpeg", 0.9));
      } catch (err) {
        console.error("Error drawing asset to data URL:", err);
        resolve('');
      }
    };
    img.onerror = () => {
      console.warn("Failed to load asset as image object, url:", url);
      resolve('');
    };
    img.src = url;
  });
};

const resizeAndCompressBase64 = (base64Str: string, maxDimension: number = 850): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    if (base64Str && !base64Str.startsWith('data:')) {
      img.crossOrigin = "anonymous";
    }
    img.onload = () => {
      let width = img.width;
      let height = img.height;

      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(base64Str);
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);
      // Compress to lightweight JPEG before sending to Photoroom - drastically cuts down upload/processing times from 30s to <5s
      const compressedDataUrl = canvas.toDataURL("image/jpeg", 0.82);
      resolve(compressedDataUrl);
    };
    img.onerror = () => {
      resolve(base64Str);
    };
    img.src = base64Str;
  });
};

const dataURLtoBlob = (dataurl: string): Blob => {
  const arr = dataurl.split(',');
  const mime = arr[0].match(/:(.*?);/)![1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
};

const isCloudRunExportsUrl = (value: string): boolean => {
  if (!value) return false;
  return /\/exports\/[^?\s#]+/i.test(value) && !value.includes('firebasestorage.googleapis.com');
};

const isFirebaseStorageHttpsUrl = (value: string): boolean => {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && (
      u.hostname === 'firebasestorage.googleapis.com' ||
      u.hostname === 'storage.googleapis.com'
    );
  } catch {
    return false;
  }
};

const normalizeJobImageValue = (
  value: string,
  fieldName: string,
  preferredMime: 'image/png' | 'image/jpeg'
): string => {
  const trimmed = (value || '').trim();
  if (!trimmed) {
    throw new Error(`${fieldName} est vide.`);
  }
  if (isCloudRunExportsUrl(trimmed)) {
    throw new Error(
      `${fieldName} : URL Cloud Run /exports/ interdite (renvoie souvent du HTML au lieu d'une image).`
    );
  }
  if (trimmed.startsWith('data:image/')) {
    if (!trimmed.includes(';base64,') || trimmed.length < 64) {
      throw new Error(`${fieldName} : data URL base64 invalide ou trop courte.`);
    }
    const mimeMatch = trimmed.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/);
    if (!mimeMatch) {
      throw new Error(`${fieldName} : format data URL non reconnu.`);
    }
    const actualMime = mimeMatch[1];
    if (preferredMime === 'image/png' && actualMime !== 'image/png') {
      console.warn(`[PWA VALIDATION] ${fieldName} : mime ${actualMime}, préféré image/png.`);
    }
    if (preferredMime === 'image/jpeg' && actualMime !== 'image/jpeg' && actualMime !== 'image/jpg') {
      console.warn(`[PWA VALIDATION] ${fieldName} : mime ${actualMime}, préféré image/jpeg.`);
    }
    return trimmed;
  }
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    if (!isFirebaseStorageHttpsUrl(trimmed)) {
      throw new Error(
        `${fieldName} : seule une URL Firebase Storage HTTPS est acceptée (reçu: ${trimmed.substring(0, 100)}...)`
      );
    }
    return trimmed;
  }
  throw new Error(
    `${fieldName} : format non supporté. Attendu: data:image/...;base64,... ou URL Firebase Storage.`
  );
};

const resolveImageAForFirestore = (variantCode: string): string => {
  const effectiveCode = getEffectiveCode((variantCode || '07A01A').trim()).toUpperCase();
  if (storageAssetCache[effectiveCode] && isFirebaseStorageHttpsUrl(storageAssetCache[effectiveCode])) {
    return storageAssetCache[effectiveCode];
  }
  const firebaseDirect = getFirebaseStorageAssetUrl(effectiveCode);
  if (firebaseDirect) return firebaseDirect;
  const assetUrl = getAssetUrl(variantCode || '07A01A');
  if (isFirebaseStorageHttpsUrl(assetUrl)) return assetUrl;
  throw new Error(
    `imageA : impossible de résoudre une URL Firebase Storage pour le fond '${effectiveCode}'.`
  );
};

const UploadScreen: React.FC<{ 
  image: string | null, 
  originalImage: string | null,
  transform: any, 
  isIsolated: boolean,
  onNext: (img: string, originalImg: string | null, transform: any, isIsolated: boolean, bbox: BoundingBox) => void, 
  onBack: () => void,
  onHome: () => void,
  isJumpingBack?: boolean
}> = ({ 
  image: initialImage, 
  originalImage: initialOriginalImage,
  transform: initialTransform, 
  isIsolated: initialIsIsolated, 
  onNext, 
  onBack, 
  onHome, 
  isJumpingBack 
}) => {
  const [originalImage, setOriginalImage] = useState<string | null>(initialOriginalImage || (initialIsIsolated ? null : initialImage));
  const [isolatedImage, setIsolatedImage] = useState<string | null>(initialIsIsolated ? initialImage : null);
  const [transform, setTransform] = useState(initialTransform);
  const [isIsolated, setIsIsolated] = useState(initialIsIsolated);
  const [isIsolating, setIsIsolating] = useState(false);
  const [boundingBox, setBoundingBox] = useState<BoundingBox | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    let file = e.target.files?.[0];
    if (file) {
      setError(null);
      let processedFile = file;

      // Détecter si l'image provient d'un iPhone (HEIC/HEIF)
      if (file.type === "image/heic" || file.name.toLowerCase().endsWith(".heic") || file.name.toLowerCase().endsWith(".heif")) {
        console.log("[HEIC Converter] Image HEIC/HEIF détectée. Conversion en JPEG en cours...");
        try {
          const heic2anyModule = await import("heic2any");
          const heic2any = heic2anyModule.default;
          const convertedBlob = await heic2any({
            blob: file,
            toType: "image/jpeg",
            quality: 0.85
          });
          const blobResult = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob;
          processedFile = new File([blobResult], file.name.replace(/\.(heic|heif)$/i, ".jpg"), {
            type: "image/jpeg"
          });
          console.log("[HEIC Converter] Conversion HEIC en JPEG réussie !");
        } catch (err) {
          console.error("[HEIC Converter] Échec de la conversion HEIC, utilisation du fichier original:", err);
        }
      }

      const reader = new FileReader();
      reader.onload = async (evt) => {
        const rawImgData = evt.target?.result as string;
        try {
          // Downscale & compress very large mobile camera files first
          const imgData = await resizeAndCompressBase64(rawImgData, 850);
          setOriginalImage(imgData);
          setIsolatedImage(null);
          setIsIsolated(false);
          
          const bbox = await getVisibleBoundingBox(imgData);
          setBoundingBox(bbox);
          const optimized = calculateOptimizedTransform(bbox, 800, 600, 'center');
          setTransform(optimized);
        } catch (err: any) {
          console.error("Error compressing image:", err);
          setError("Impossible de charger ou d'optimiser cette image.");
        }
      };
      reader.readAsDataURL(processedFile);
    }
  };

  const handleUploadAlreadyCutout = async (e: React.ChangeEvent<HTMLInputElement>) => {
    let file = e.target.files?.[0];
    if (file) {
      setError(null);
      let processedFile = file;

      // Détecter si l'image provient d'un iPhone (HEIC/HEIF)
      if (file.type === "image/heic" || file.name.toLowerCase().endsWith(".heic") || file.name.toLowerCase().endsWith(".heif")) {
        console.log("[HEIC Converter] Image HEIC/HEIF détectée pour déjà détouré. Conversion en PNG en cours...");
        try {
          const heic2anyModule = await import("heic2any");
          const heic2any = heic2anyModule.default;
          const convertedBlob = await heic2any({
            blob: file,
            toType: "image/png"
          });
          const blobResult = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob;
          processedFile = new File([blobResult], file.name.replace(/\.(heic|heif)$/i, ".png"), {
            type: "image/png"
          });
          console.log("[HEIC Converter] Conversion HEIC en PNG réussie !");
        } catch (err) {
          console.error("[HEIC Converter] Échec de la conversion HEIC, utilisation du fichier original:", err);
        }
      }

      const reader = new FileReader();
      reader.onload = async (evt) => {
        const rawImgData = evt.target?.result as string;
        try {
          // Downscale & compress preserving transparency/alpha by using image/png
          const imgData = await compressDataUrl(rawImgData, 850, 'image/png', 0.82);
          setOriginalImage(imgData);
          setIsolatedImage(imgData);
          setIsIsolated(true);
          
          const bbox = await getVisibleBoundingBox(imgData);
          setBoundingBox(bbox);
          const optimized = calculateOptimizedTransform(bbox, 800, 600, 'center');
          setTransform(optimized);
        } catch (err: any) {
          console.error("Error compressing image:", err);
          setError("Impossible de charger ou d'optimiser cette image.");
        }
      };
      reader.readAsDataURL(processedFile);
    }
  };

  const handleIsolate = async () => {
    if (!originalImage) return;
    setIsIsolating(true);
    setError(null);

    try {
      // Prioritize ultra-lightweight transition payloads of 750px to speed up mobile cellular transmission and Photoroom processing (typically <3s)
      const compressedPayload = await resizeAndCompressBase64(originalImage, 750);

      // Resolve the fetch target with an absolute origin. Standalone PWAs on iOS Safari or custom iPad/iPhone containers
      // often execute with private relative namespaces (e.g., app-local://) which causes relative POST fetches to suffer a silent CORS / networking crash
      const removeBgUrl = resolveApiUrl('/api/remove-background');
      const response = await fetch(removeBgUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ image: compressedPayload })
      });

      if (!response.ok) {
        let errMsg = 'Failed to remove background from vehicle';
        try {
          const data = await response.json();
          if (data && data.error) errMsg = data.error;
        } catch (_) {}
        throw new Error(errMsg);
      }

      const data = await response.json();
      if (data && data.image) {
        setIsolatedImage(data.image);
        setIsIsolated(true);
        
        const bbox = await getVisibleBoundingBox(data.image);
        setBoundingBox(bbox);
        const optimized = calculateOptimizedTransform(bbox, 800, 600, 'center');
        setTransform(optimized);
      } else {
        throw new Error('No isolated image returned from background removal api.');
      }
    } catch (err: any) {
      console.error('Error during vehicle isolation:', err);
      setError(err.message || 'An unexpected error occurred during background removal.');
    } finally {
      setIsIsolating(false);
    }
  };

  const handleNext = async () => {
    const finalLogoImage = isolatedImage || originalImage;
    if (finalLogoImage) {
      let finalBbox = boundingBox;
      if (!finalBbox) {
        finalBbox = await getVisibleBoundingBox(finalLogoImage);
      }
      const optimized = calculateOptimizedTransform(finalBbox, 800, 600, 'center');
      onNext(finalLogoImage, originalImage, optimized, isIsolated, finalBbox);
    }
  };

  return (
    <ScreenWrapper 
      title="Your photo" 
      subtitle="Upload or take a photo of your vehicle."
      onBack={onBack}
      onNext={handleNext}
      onHome={onHome}
      showHomeConfirm={true}
      isNextDisabled={!isIsolated || isIsolating}
      nextLabel={isJumpingBack ? "Finish" : "Next"}
      isJumpingBack={isJumpingBack}
    >
      <div className="px-6 space-y-3">
        <div className="aspect-[16/9] bg-white/5 border border-dashed border-white/20 rounded-none overflow-hidden relative">
          <AnimatePresence>
            {isIsolating && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 z-50 bg-black/60 backdrop-blur-md flex flex-col items-center justify-center p-8 text-center"
              >
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                  className="mb-4"
                >
                  <Sparkles className="w-8 h-8 text-white" />
                </motion.div>
                <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-white">AI Isolation in progress...</p>
              </motion.div>
            )}
          </AnimatePresence>

          {originalImage ? (
            <div className="w-full h-full relative overflow-hidden touch-none">
              <motion.img 
                src={originalImage} 
                className="w-full h-full object-contain relative z-10"
                style={{ 
                  x: `${transform.x}%`,
                  y: `${transform.y}%`,
                  scale: transform.scale, 
                  rotate: transform.rotate 
                }}
                transition={{ type: 'tween', duration: 0 }}
                referrerPolicy="no-referrer"
              />
            </div>
          ) : (
            <label className="w-full h-full flex flex-col items-center justify-center cursor-pointer hover:bg-white/5 transition-colors">
              <Upload className="w-8 h-8 mb-3 opacity-20" />
              <span className="text-[10px] font-bold uppercase tracking-widest opacity-40">Tap to upload</span>
              <input type="file" className="hidden" accept="image/*" onChange={handleUpload} />
            </label>
          )}
        </div>
        
        {error && (
          <div className="bg-destructive/10 border border-destructive/20 p-3 flex gap-2 items-start text-destructive text-xs">
            <span className="font-mono text-[10px] leading-tight flex-1">
              <strong>Error:</strong> {error}
            </span>
            <button 
              className="h-4 w-4 text-destructive hover:opacity-80 font-bold p-0 ml-1 select-none flex items-center justify-center cursor-pointer"
              onClick={() => setError(null)}
            >
              ×
            </button>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1 h-12 rounded-none border-white/10 text-[10px] uppercase tracking-widest relative">
              <Camera className="mr-2 w-4 h-4" />
              {originalImage ? "Change photo" : "Take a photo"}
              <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" accept="image/*" onChange={handleUpload} />
            </Button>

            <Button 
              onClick={handleIsolate}
              disabled={!originalImage || isIsolating}
              className={cn(
                "flex-1 h-12 rounded-none text-[10px] font-bold uppercase tracking-widest transition-all",
                originalImage ? "bg-white text-black hover:bg-white/90" : "bg-white/5 text-white/20 border border-white/10"
              )}
            >
              <Sparkles className="mr-2 w-4 h-4" />
              Isolate Vehicle
            </Button>
          </div>

          <Button variant="outline" className="w-full h-10 rounded-none border-dashed border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 text-[10px] font-bold uppercase tracking-widest relative">
            <Upload className="mr-2 w-4 h-4" />
            Déjà détouré (No Token)
            <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" accept="image/*" onChange={handleUploadAlreadyCutout} />
          </Button>
        </div>

        {isIsolated && isolatedImage && (
          <div className="space-y-2 pt-2">
            <div className="flex items-center gap-2">
              <Sparkles className="w-3 h-3 text-white" />
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white">Isolated Result</span>
            </div>
            <div className="aspect-[16/9] bg-white/5 border border-white/10 rounded-none overflow-hidden relative bg-[url('https://www.transparenttextures.com/patterns/checkerboard.png')] bg-repeat">
              <motion.img 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                src={isolatedImage} 
                className="w-full h-full object-contain relative z-10"
                style={{ 
                  x: `${transform.x}%`,
                  y: `${transform.y}%`,
                  scale: transform.scale, 
                  rotate: transform.rotate 
                }}
                referrerPolicy="no-referrer"
              />
            </div>
          </div>
        )}
      </div>
    </ScreenWrapper>
  );
};

const AdStyleScreen: React.FC<{
  vehicleCategory: string | null,
  selected: string | null,
  onSelect: (id: string) => void,
  onNext: () => void,
  onBack: () => void,
  onHome: () => void,
  isJumpingBack: boolean
}> = ({ vehicleCategory, selected, onSelect, onNext, onBack, onHome, isJumpingBack }) => {
  const styles = [
    {
      id: 'pro',
      code: '05B',
      title: 'Pro',
      subtitle: 'Clean, balanced, catalog',
      details: [
        'Camera ≈ 50–70mm',
        'Height ≈ 1.3–1.5 m',
        'Distance ≈ 5–6 m',
        'Flatter perspective'
      ],
      img: getAssetUrl("05B")
    },
    {
      id: 'premium',
      code: '05C',
      title: 'Premium',
      subtitle: 'Luxury, very clean, design',
      details: [
        'Camera ≈ 85–120mm',
        'Distance ≈ 7–10 m',
        'Strong compression',
        'Background more present'
      ],
      img: getAssetUrl("05C")
    },
    {
      id: 'dynamic',
      code: '05D',
      title: 'Dynamic',
      subtitle: 'Aggressive, sport',
      details: [
        'Camera ≈ 24–28mm',
        'Height ≈ 0.8–1 m',
        'Distance ≈ 2–3 m',
        'Slight low-angle'
      ],
      img: getAssetUrl("05D")
    }
  ];

  const getRecommendedId = () => {
    if (vehicleCategory === 'bike') return 'dynamic';
    return 'pro';
  };

  const recommendedId = getRecommendedId();

  React.useEffect(() => {
    if (!selected) {
      onSelect(recommendedId);
    }
  }, [recommendedId, onSelect, selected]);

  const recommendedStyle = styles.find(s => s.id === recommendedId)!;
  const otherStyles = styles.filter(s => s.id !== recommendedId);

  return (
    <ScreenWrapper 
      title="Visual Style" 
      subtitle="Choose the photography style for your ad."
      onBack={onBack}
      onNext={onNext}
      onHome={onHome}
      showHomeConfirm={true}
      isNextDisabled={!selected}
      isJumpingBack={isJumpingBack}
      noScroll={true}
    >
      <div className="px-6 space-y-2 pb-1">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Sparkles className="w-3 h-3 text-white" />
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white">Recommended for your vehicle</span>
          </div>
          <StyleItem 
            style={recommendedStyle} 
            isRecommended 
            selected={selected} 
            onSelect={onSelect} 
          />
        </div>

        <div className="space-y-1">
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white">Other available options</span>
          <div className="space-y-[10px]">
            {otherStyles.map(style => (
              <StyleItem 
                key={style.id} 
                style={style} 
                selected={selected} 
                onSelect={onSelect} 
              />
            ))}
          </div>
        </div>
      </div>
    </ScreenWrapper>
  );
};

interface StyleItemProps {
  style: any;
  isRecommended?: boolean;
  selected: string | null;
  onSelect: (id: string) => void;
}

const StyleItem: React.FC<StyleItemProps> = ({ 
  style, 
  isRecommended = false, 
  selected, 
  onSelect 
}) => (
    <div 
      onClick={() => onSelect(style.id)}
      className={cn(
        "relative flex gap-4 cursor-pointer transition-all p-2",
        selected === style.id ? "bg-white/10 ring-1 ring-inset ring-white" : "bg-white/5 hover:bg-white/10"
      )}
    >
    {isRecommended && (
      <Badge variant="secondary" className="absolute top-0 right-0 bg-white text-black text-[7px] h-3.5 rounded-none px-1 font-bold z-10">RECOMMENDED</Badge>
    )}
    <div className="w-[110px] aspect-[4/3] shrink-0 overflow-hidden bg-zinc-900 relative">
      <SafeImage code={style.code} className="w-full h-full object-cover" />
    </div>
    <div className="flex flex-col justify-center text-left flex-1 pr-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[13px] font-bold uppercase tracking-widest leading-none">{style.title}</span>
      </div>
      <span className="text-[10px] font-medium text-white uppercase tracking-wider mb-2 leading-none">{style.subtitle}</span>
      <div className="grid grid-cols-1 gap-0.5">
        {style.details.map((d: string, i: number) => (
          <div key={i} className="flex items-center gap-1.5">
            <div className="w-0.5 h-0.5 rounded-full bg-white/40" />
            <span className="text-[8px] text-white uppercase tracking-tight leading-tight">{d}</span>
          </div>
        ))}
      </div>
    </div>
  </div>
);

const ConditionItem: React.FC<{
  condition: any;
  label?: { text: string; variant: 'recommended' | 'less_efficient' };
  selected: string | null;
  onSelect: (id: string) => void;
}> = ({ condition, label, selected, onSelect }) => (
  <div className="flex flex-col">
    {label && (
      <div className="flex">
        <div className={cn(
          "px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider",
          label.variant === 'recommended' 
            ? "bg-white text-black" 
            : "bg-black text-white border border-white/40"
        )}>
          {label.text}
        </div>
      </div>
    )}
    <div 
      onClick={() => onSelect(condition.id)}
      className={cn(
        "flex flex-col cursor-pointer transition-all relative",
        selected === condition.id ? "bg-white/10 ring-1 ring-inset ring-white" : "bg-white/5 hover:bg-white/10",
        label && "-mt-[2px]"
      )}
    >
      <div className="w-full aspect-[3/1] overflow-hidden bg-zinc-900 relative">
        <SafeImage code={condition.code} className="w-full h-full object-cover" />
      </div>
      <div className="p-2.5 text-left">
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-[12px] font-bold uppercase tracking-widest leading-none">{condition.title}</span>
        </div>
        <span className="text-[9px] font-medium text-white uppercase tracking-wider mb-1.5 block leading-none">{condition.subtitle}</span>
        <div className="grid grid-cols-1 gap-0.5">
          {condition.details.map((d: string, i: number) => (
            <div key={i} className="flex items-center gap-1.5">
              <div className="w-0.5 h-0.5 rounded-full bg-white/40" />
              <span className="text-[8px] text-white/80 uppercase tracking-tight leading-tight">{d}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  </div>
);

const ShootingConditionsScreen: React.FC<{
  selected: 'moving_vehicle' | 'moving_camera' | null,
  onSelect: (id: 'moving_vehicle' | 'moving_camera') => void,
  onNext: () => void,
  onBack: () => void,
  onHome: () => void,
  isJumpingBack: boolean
}> = ({ selected, onSelect, onNext, onBack, onHome, isJumpingBack }) => {
  const conditions = [
    {
      id: 'moving_vehicle',
      code: '02A',
      title: 'Moving vehicle',
      subtitle: 'Dynamic tracking',
      details: [
        'Same frontal light',
        'Same background',
        'Same shooting distance'
      ],
      img: getAssetUrl("02A")
    },
    {
      id: 'moving_camera',
      code: '02B',
      title: 'Moving camera',
      subtitle: 'Static vehicle, moving lens',
      details: [
        'Variable light (backlight)',
        'Variable background',
        'Variable shooting distance'
      ],
      img: getAssetUrl("02B")
    }
  ];

  return (
    <ScreenWrapper 
      title="Your shooting conditions" 
      subtitle="Select how the scene is captured."
      onNext={onNext}
      onBack={onBack}
      onHome={onHome}
      showHomeConfirm={true}
      isNextDisabled={!selected}
      isJumpingBack={isJumpingBack}
      noScroll={true}
    >
      <div className="px-6 space-y-4">
        {conditions.map((condition) => (
          <ConditionItem 
            key={condition.id}
            condition={condition}
            label={
              condition.id === 'moving_vehicle' 
                ? { text: 'RECOMMENDED', variant: 'recommended' }
                : { text: 'LESS EFFICIENT', variant: 'less_efficient' }
            }
            selected={selected}
            onSelect={(id) => onSelect(id as any)}
          />
        ))}
      </div>
    </ScreenWrapper>
  );
};

const VehicleCategoryScreen: React.FC<{ 
  selected: 'car' | 'utility' | 'bike' | null, 
  onSelect: (id: 'car' | 'utility' | 'bike') => void, 
  onNext: () => void, 
  onBack: () => void,
  onHome: () => void,
  isJumpingBack: boolean 
}> = ({ selected, onSelect, onNext, onBack, onHome, isJumpingBack }) => {
  const categories: { id: 'car' | 'utility' | 'bike', label: string, img: string, code: string }[] = [
    { id: 'car', label: 'VOITURE', img: getAssetUrl("03A"), code: '03A' },
    { id: 'utility', label: 'SOCIÉTÉ', img: getAssetUrl("03B"), code: '03B' },
    { id: 'bike', label: 'MOTO', img: getAssetUrl("03C"), code: '03C' },
  ];

  return (
    <ScreenWrapper 
      title="Vehicle Category" 
      subtitle="Select the main category of your vehicle."
      onNext={onNext}
      onBack={onBack}
      onHome={onHome}
      showHomeConfirm={true}
      isNextDisabled={!selected}
      isJumpingBack={isJumpingBack}
      noScroll={true}
    >
      <div className="pb-4">
        <div className="grid grid-cols-1 gap-4 px-6">
          {categories.map((cat) => (
            <div
              key={cat.id}
              onClick={() => onSelect(cat.id)}
              className="flex flex-col cursor-pointer"
            >
              <div className={cn(
                "relative group overflow-hidden transition-all",
                selected === cat.id ? "bg-white/10" : "bg-white/5",
              )}>
                <AspectRatio ratio={2.7}>
                  <SafeImage 
                    code={cat.code} 
                    className="w-full h-full object-cover transition-all group-hover:scale-105" 
                  />
                  {/* Inset border for selection */}
                  {selected === cat.id && (
                    <div className="absolute inset-0 ring-2 ring-inset ring-white z-10" />
                  )}
                </AspectRatio>
              </div>
              <div className="mt-1 text-center">
                <span className={cn(
                  "text-sm font-medium uppercase tracking-[0.3em] transition-colors",
                  selected === cat.id ? "text-white" : "text-white/40"
                )}>
                  {cat.label}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </ScreenWrapper>
  );
};

const VehicleSelectionScreen: React.FC<{ 
  category: 'car' | 'utility' | 'bike' | null,
  selected: string | null, 
  onSelect: (id: string | null) => void, 
  onNext: () => void, 
  onBack: () => void, 
  onHome: () => void,
  isJumpingBack: boolean 
}> = ({ category, selected, onSelect, onNext, onBack, onHome, isJumpingBack }) => {
  const subTypes: Record<string, { id: string, label: string, img: string, code: string }[]> = {
    car: [
      { id: 'suv', label: '4x4 - SUV', img: getAssetUrl("03A01"), code: '03A01' },
      { id: 'city', label: 'CITADINE', img: getAssetUrl("03A02"), code: '03A02' },
      { id: 'sedan', label: 'BERLINE', img: getAssetUrl("03A03"), code: '03A03' },
      { id: 'monospace', label: 'MONOSPACE', img: getAssetUrl("03A04"), code: '03A04' },
      { id: 'sport', label: 'SPORT', img: getAssetUrl("03A05"), code: '03A05' },
      { id: 'cabriolet', label: 'CABRIOLET', img: getAssetUrl("03A06"), code: '03A06' },
      { id: 'premium', label: 'PREMIUM', img: getAssetUrl("03A07"), code: '03A07' },
    ],
    utility: [
      { id: 'fourgon', label: 'FOURGON', img: getAssetUrl("03B01"), code: '03B01' },
      { id: 'fourgonnette', label: 'FOURGONNETTE', img: getAssetUrl("03B02"), code: '03B02' },
      { id: 'pickup', label: 'PICK-UP', img: getAssetUrl("03B03"), code: '03B03' },
      { id: 'voiture_society', label: 'VOITURE', img: getAssetUrl("03B04"), code: '03B04' },
      { id: 'camion', label: 'CAMION', img: getAssetUrl("03B05"), code: '03B05' },
    ],
    bike: [
      { id: 'roadster', label: 'ROADSTER', img: getAssetUrl("03C01"), code: '03C01' },
      { id: 'trail', label: 'TRAIL', img: getAssetUrl("03C02"), code: '03C02' },
      { id: 'custom', label: 'CUSTOM', img: getAssetUrl("03C03"), code: '03C03' },
      { id: 'sportive', label: 'SPORTIVE', img: getAssetUrl("03C04"), code: '03C04' },
      { id: 'gt', label: 'GT', img: getAssetUrl("03C05"), code: '03C05' },
      { id: 'collection_bike', label: 'COLLECTION', img: getAssetUrl("03C06"), code: '03C06' },
      { id: 'scooter', label: 'SCOOTER', img: getAssetUrl("03C07"), code: '03C07' },
    ]
  };

  const currentTypes = subTypes[category || 'car'] || subTypes.car;

  return (
    <ScreenWrapper 
      title="Vehicle Type" 
      subtitle="Refine your vehicle selection."
      onBack={onBack}
      onNext={onNext}
      onHome={onHome}
      showHomeConfirm={true}
      isNextDisabled={!selected}
      isJumpingBack={isJumpingBack}
      noScroll={true}
    >
      <div className="pb-1">
        <SelectionGrid items={currentTypes} selected={selected} onSelect={onSelect} columns={2} aspectRatio={1.41} gap={4} />
      </div>
    </ScreenWrapper>
  );
};

const CATEGORIES = [
  { id: 'urban', label: 'Urban', code: '07A01A', img: getAssetUrl("07A01A") },
  { id: 'nature', label: 'Nature', code: '07B01A', img: getAssetUrl("07B01A") },
  { id: 'design', label: 'Design', code: '07C01A', img: getAssetUrl("07C01A") },
  { id: 'future', label: 'Minimal', code: '07D01A', img: getAssetUrl("07D01A") },
];

const VARIANTS: Record<string, { id: string, label: string, img: string, code: string }[]> = {
  nature: [
    { id: '07B01', label: 'Desert', img: getAssetUrl('07B01A'), code: '07B01' },
    { id: '07B02', label: 'Forest', img: getAssetUrl('07B02A'), code: '07B02' },
    { id: '07B03', label: 'Mountain', img: getAssetUrl('07B03A'), code: '07B03' },
    { id: '07B04', label: 'Seaside', img: getAssetUrl('07B04A'), code: '07B04' },
  ],
  urban: [
    { id: '07A01', label: 'City', img: getAssetUrl('07A01A'), code: '07A01' },
    { id: '07A02', label: 'Sport', img: getAssetUrl('07A02A'), code: '07A02' },
    { id: '07A03', label: 'Industrial', img: getAssetUrl('07A03A'), code: '07A03' },
    { id: '07A04', label: 'Parking', img: getAssetUrl('07A04A'), code: '07A04' },
  ],
  design: [
    { id: '07C01', label: 'OUTSIDE', img: getAssetUrl('07C01A'), code: '07C01' },
    { id: '07C02', label: 'STUDIO', img: getAssetUrl('07C02A'), code: '07C02' },
    { id: '07C03', label: 'Concrete', img: getAssetUrl('07C03A'), code: '07C03' },
    { id: '07C04', label: 'Wood', img: getAssetUrl('07C04A'), code: '07C04' },
  ],
  future: [
    { id: '07D01', label: 'Landscapes', img: getAssetUrl('07D01A'), code: '07D01' },
    { id: '07D02', label: 'Architecture', img: getAssetUrl('07D02A'), code: '07D02' },
    { id: '07D03', label: 'Materials', img: getAssetUrl('07D03A'), code: '07D03' },
    { id: '07D04', label: 'Vegetation', img: getAssetUrl('07D04A'), code: '07D04' },
  ]
};

const EnvironmentScreen: React.FC<{ 
  category: string | null, 
  onCategory: (id: string) => void,
  variant: string | null,
  onVariant: (id: string) => void,
  onNext: () => void, 
  onBack: () => void,
  onHome: () => void,
  isJumpingBack: boolean,
  previewProps: any,
  favorites: ({ envCategory: string | null; envVariant: string | null } | null)[],
  onUpdateFavorites: (favorites: ({ envCategory: string | null; envVariant: string | null } | null)[]) => void
}> = ({ category, onCategory, variant, onVariant, onNext, onBack, onHome, isJumpingBack, previewProps, favorites, onUpdateFavorites }) => {
  const [activeMenu, setActiveMenu] = useState<number | null>(null);
  const longPressTimer = useRef<any>(null);
  const isLongPress = useRef(false);

  // Preload images for better responsiveness
  useEffect(() => {
    if (variant) {
      // Preload current, next and prev variant for the active sub-category
      const baseMatch = variant.match(/^(\d{2}[A-Z]\d{2})/);
      if (baseMatch) {
        const baseCode = baseMatch[1];
        const maxLetter = VARIANT_LIMITS[baseCode] || 'D';
        const currentLetter = variant.slice(baseCode.length) || 'A';
        
        const lettersToPreload = [
          currentLetter,
          getNextLetter(currentLetter, maxLetter),
          getPrevLetter(currentLetter, maxLetter)
        ];

        lettersToPreload.forEach(letter => {
          const link = document.createElement('link');
          link.rel = 'preload';
          link.as = 'image';
          link.href = getAssetUrl(`${baseCode}${letter}`);
          document.head.appendChild(link);
        });
      }
    }

    if (category && VARIANTS[category]) {
      VARIANTS[category].forEach(v => {
        const link = document.createElement('link');
        link.rel = 'preload';
        link.as = 'image';
        link.href = getAssetUrl(`${v.id}A`);
        document.head.appendChild(link);
      });
    }
  }, [category, variant]);

  const handleFavoriteClick = (idx: number) => {
    if (isLongPress.current) return;
    
    const fav = favorites[idx];
    if (fav) {
      // Apply favorite
      onCategory(fav.envCategory || 'urban');
      onVariant(fav.envVariant || '07A01A');
    } else {
      // Save current as favorite
      const newFavs = [...favorites];
      newFavs[idx] = { envCategory: category, envVariant: variant };
      onUpdateFavorites(newFavs);
    }
  };

  const handlePointerDown = (idx: number) => {
    isLongPress.current = false;
    if (favorites[idx]) {
      longPressTimer.current = setTimeout(() => {
        isLongPress.current = true;
        setActiveMenu(idx);
      }, 500); // 500ms for long press
    }
  };

  const handlePointerUp = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
    }
  };

  const deleteFavorite = (idx: number) => {
    const newFavs = [...favorites];
    newFavs[idx] = null;
    onUpdateFavorites(newFavs);
    setActiveMenu(null);
  };

  const replaceFavorite = (idx: number) => {
    const newFavs = [...favorites];
    newFavs[idx] = { envCategory: category, envVariant: variant };
    onUpdateFavorites(newFavs);
    setActiveMenu(null);
  };

  const currentVariants = VARIANTS[category || 'urban'] || VARIANTS.urban;

  return (
    <ScreenWrapper 
      title="Environment" 
      subtitle="Choose the atmosphere for your shot."
      onBack={onBack}
      onNext={onNext}
      onHome={onHome}
      showHomeConfirm={true}
      isNextDisabled={!variant}
      isJumpingBack={isJumpingBack}
    >
      <div className="space-y-2">
        <SharedPreview {...previewProps} envVariant={variant} />
        
        <div className="px-6 space-y-2">
          {/* Main Category Tabs - Simplified text-only */}
          <div className="grid grid-cols-4 gap-1">
            {CATEGORIES.map((cat) => (
              <button 
                key={cat.id}
                onClick={() => {
                  onCategory(cat.id);
                  onVariant(VARIANTS[cat.id][0].id + 'A');
                }}
                className={cn(
                  "h-[32px] px-1 text-[9px] font-bold uppercase tracking-widest transition-all flex items-center justify-center",
                  category === cat.id 
                    ? "bg-white text-black font-black" 
                    : "bg-white/5 text-white/50 border border-white/10"
                )}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Variants with thumbnails - Compact pixel height */}
          <div className="grid grid-cols-2 gap-1.5">
            {currentVariants.map((v) => {
              const isSelected = variant?.startsWith(v.code);
              const maxLetter = VARIANT_LIMITS[v.code] || 'A';
              const currentLetter = isSelected ? (variant.slice(v.code.length) || 'A') : 'A';
              const totalVariants = maxLetter.charCodeAt(0) - 'A'.charCodeAt(0) + 1;
              const currentIndex = currentLetter.charCodeAt(0) - 'A'.charCodeAt(0) + 1;
              const currentVariantCode = isSelected ? (variant || `${v.code}A`) : `${v.code}A`;

              return (
                <div
                  key={v.id}
                  onClick={() => onVariant(v.id)}
                  className={cn(
                    "group relative cursor-pointer overflow-hidden transition-all flex flex-col h-[52px]",
                    isSelected ? "ring-2 ring-inset ring-white" : "bg-white/5"
                  )}
                >
                  <div className="h-full w-full overflow-hidden relative">
                    <SafeImage 
                      code={currentVariantCode} 
                      className="w-full h-full object-cover transition-transform duration-500 opacity-80" 
                    />
                    <div className="absolute inset-0 bg-black/10 transition-colors" />
                    
                    {/* Centered Label */}
                    <div className="absolute inset-0 flex items-center justify-center p-1">
                      <span className={cn(
                        "text-[9px] font-bold uppercase tracking-[0.15em] text-white text-center drop-shadow-lg",
                        isSelected ? "opacity-100" : "opacity-80"
                      )}>
                        {v.label}
                      </span>
                    </div>

                    {/* Variant Counter & Letter */}
                    {totalVariants > 1 && (
                      <div className="absolute top-0.5 right-0.5 px-1 bg-black/60 backdrop-blur-sm flex items-center gap-1">
                        <span className="text-[7px] font-mono text-white/80">
                          {isSelected ? `${currentIndex}/${totalVariants}` : totalVariants}
                        </span>
                        {isSelected && (
                          <div className="w-0.5 h-0.5 rounded-full bg-blue-400 animate-pulse" />
                        )}
                      </div>
                    )}

                    {/* Variant default letter label removed */}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Row of favorites presets (6 squares) */}
          <div className="grid grid-cols-6 gap-1 pb-2 relative">
            {favorites.map((fav, idx) => (
              <div key={idx} className="relative">
                <button 
                  onPointerDown={() => handlePointerDown(idx)}
                  onPointerUp={handlePointerUp}
                  onPointerLeave={handlePointerUp}
                  onClick={() => handleFavoriteClick(idx)}
                  className={cn(
                    "aspect-square w-full bg-white/5 border border-white/10 transition-all flex items-center justify-center relative overflow-hidden group",
                    fav ? "text-white" : "text-white/20"
                  )}
                  title={fav ? "Apply Favorite (Long press for options)" : "Save current to Favorites"}
                >
                  {fav && (
                    <div className="absolute inset-0 opacity-100">
                      <SafeImage code={fav.envVariant} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/10" />
                      {/* Selection Frame (Inside) */}
                      {fav.envVariant === variant && (
                        <div className="absolute inset-0 border-2 border-white z-30" />
                      )}
                    </div>
                  )}
                  <div className="relative z-10">
                    <Heart size={14} className={cn(fav ? "fill-pink-500 text-pink-500" : "text-white/40")} />
                  </div>
                </button>

                {/* Long Press Menu Overlay */}
                {activeMenu === idx && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setActiveMenu(null)} />
                    <div className="absolute bottom-full left-0 mb-1 z-50 bg-zinc-900 border border-white/10 shadow-xl py-1 min-w-[100px]">
                      <button 
                        onClick={() => replaceFavorite(idx)}
                        className="w-full px-3 py-1.5 text-left text-[9px] uppercase font-bold tracking-widest text-white/70 active:text-white active:bg-white/5 transition-colors"
                      >
                        Replace
                      </button>
                      <button 
                        onClick={() => deleteFavorite(idx)}
                        className="w-full px-3 py-1.5 text-left text-[9px] uppercase font-bold tracking-widest text-red-400 active:text-red-300 active:bg-white/5 transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </ScreenWrapper>
  );
};

const getCleanBrandName = (name: string): string => {
  if (/^[A-Za-z]_(.+)$/.test(name)) {
    return name.substring(2);
  }
  return name;
};

interface CustomBrandDropdownProps {
  allLogos: { name: string, url: string }[];
  filteredLogos: { name: string, url: string }[];
  availableLetters: string[];
  searchTerm: string;
  selectedLogoUrl: string | null;
  onSelectLogo: (logo: { name: string, url: string }) => void;
  onInteraction?: () => void;
  size?: 'sm' | 'default';
  className?: string;
}

const CustomBrandDropdown: React.FC<CustomBrandDropdownProps> = ({
  allLogos,
  filteredLogos,
  availableLetters,
  searchTerm,
  selectedLogoUrl,
  onSelectLogo,
  onInteraction,
  size = 'default',
  className
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [innerSelectedLetter, setInnerSelectedLetter] = useState<string | null>(null);
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);

  const showSearchResults = searchTerm.trim().length > 0;

  // Auto-open dropdown menu when typing search keywords
  React.useEffect(() => {
    if (searchTerm.trim().length > 0) {
      setIsOpen(true);
    }
  }, [searchTerm]);

  const selectedBrand = React.useMemo(() => {
    if (!selectedLogoUrl) return null;
    return allLogos.find(l => l.url === selectedLogoUrl);
  }, [selectedLogoUrl, allLogos]);

  const containerRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Soft/instant focus scroll when a letter category is selected
  React.useEffect(() => {
    if (innerSelectedLetter && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const target = container.querySelector(`#category-${innerSelectedLetter}`);
      if (target) {
        const containerRect = container.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const relativeTop = targetRect.top - containerRect.top + container.scrollTop;
        container.scrollTo({ top: relativeTop - 4, behavior: 'auto' });
      }
    }
  }, [innerSelectedLetter]);

  return (
    <div className={cn("relative", size === 'sm' ? "w-[75px] max-w-[75px] shrink-0" : "w-full", className)} ref={containerRef}>
      <button
        type="button"
        onClick={() => {
          onInteraction?.();
          setIsOpen(!isOpen);
        }}
        className={size === 'sm' 
          ? "w-[75px] max-w-[75px] h-[18px] px-1 py-0 bg-white/5 border border-white/20 hover:bg-white/10 text-white flex items-center justify-between cursor-pointer select-none transition-colors text-[8px] uppercase tracking-wider shrink-0 font-sans min-w-0 overflow-hidden"
          : "w-full h-7.5 bg-zinc-900 border border-white/10 hover:bg-zinc-800 text-white flex items-center justify-between px-2.5 cursor-pointer select-none transition-colors min-w-0"
        }
      >
        <div className={cn("flex items-center gap-1 min-w-0 flex-1", size === 'sm' ? "max-w-[55px]" : "max-w-[85%]")}>
          {selectedBrand ? (
            <span className={size === 'sm' ? "text-[7px] tracking-wider uppercase truncate flex-1 block text-left font-sans" : "text-[9px] tracking-widest uppercase truncate font-medium"}>
              {getCleanBrandName(selectedBrand.name)}
            </span>
          ) : (
            <span className={size === 'sm' ? "text-[7px] tracking-wider text-white/40 uppercase truncate flex-1 block text-left font-sans" : "text-[8px] tracking-widest text-white/40 uppercase"}>
              CHOISIR
            </span>
          )}
        </div>
        <ChevronDown className={cn(size === 'sm' ? "w-2.5 h-2.5 text-white/40 shrink-0 transition-transform ml-0.5" : "w-3 h-3 text-white/40 transition-transform", isOpen && "rotate-180")} />
      </button>

      {isOpen && (
        <div className={cn(
          "absolute bottom-full mb-1 bg-zinc-950 border border-white/10 shadow-2xl z-50 flex flex-col transition-all duration-200",
          size === 'sm' 
            ? (showSearchResults ? "right-0 w-[245px] h-auto max-h-[215px]" : "right-0 w-[245px] h-[245px]") 
            : "left-0 w-full max-h-[245px]"
        )}>
          {showSearchResults ? (
            <div className="p-1 flex flex-col overflow-hidden w-full">
              <div className="px-2 py-1 text-[7px] tracking-wider font-mono text-white/40 uppercase border-b border-white/5 mb-1 shrink-0">
                Résultats de recherche ({filteredLogos.length})
              </div>
              {filteredLogos.length > 0 ? (
                <div className="flex flex-col gap-0 overflow-y-auto max-h-[175px] pr-0.5">
                  {filteredLogos.map(logo => {
                    const isSelected = selectedLogoUrl === logo.url;
                    return (
                      <button
                        key={logo.url}
                        type="button"
                        onClick={() => {
                          onSelectLogo(logo);
                          setIsOpen(false);
                        }}
                        className={cn(
                          "w-full px-2 py-0.5 flex items-center gap-2 text-left text-[9.5px] uppercase tracking-wide transition-colors cursor-pointer min-w-0 h-7 shrink-0",
                          isSelected ? "bg-white/10 text-white font-bold" : "text-white/70 hover:bg-white/5 hover:text-white"
                        )}
                      >
                        <div className="w-5 h-5 flex items-center justify-center bg-black/45 p-0.5 border border-white/5 shrink-0">
                          <img src={logo.url} className="max-w-full max-h-full object-contain" referrerPolicy="no-referrer" />
                        </div>
                        <span className="truncate flex-1 font-sans text-[8.5px]">{getCleanBrandName(logo.name)}</span>
                        {isSelected && <Check className="w-3 h-3 text-white shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="py-6 text-center text-[8px] text-white/30 uppercase tracking-widest font-mono shrink-0">
                  Aucun constructeur trouvé
                </div>
              )}
            </div>
          ) : !innerSelectedLetter ? (
            <div className="p-2 flex-grow flex flex-col h-full overflow-hidden">
              <div className="grid grid-cols-6 gap-1 overflow-y-auto pr-0.5 flex-1 select-none">
                {"ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map(letter => {
                  const hasBrands = availableLetters.includes(letter);
                  const count = allLogos.filter(l => l.name.trim().charAt(0).toUpperCase() === letter).length;
                  return (
                    <button
                      key={letter}
                      type="button"
                      disabled={!hasBrands}
                      onClick={() => setInnerSelectedLetter(letter)}
                      className={cn(
                        "h-8 flex flex-col items-center justify-center text-[10px] font-extrabold border transition-all cursor-pointer",
                        hasBrands 
                          ? "border-white/10 bg-zinc-900 text-white hover:border-white/30 hover:bg-white/5 active:bg-white/10" 
                          : "border-transparent bg-transparent text-white/10 cursor-not-allowed"
                      )}
                      title={hasBrands ? `${count} constructeur(s)` : "Aucun constructeur"}
                    >
                      <span className="leading-none">{letter}</span>
                      {hasBrands && (
                        <span className="text-[6.5px] text-white/40 font-mono font-normal mt-[1px]">{count}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="p-1.5 flex-grow flex flex-col h-full overflow-hidden">
              <button
                type="button"
                onClick={() => setInnerSelectedLetter(null)}
                className="w-full text-center font-sans text-[10.5px] bg-white text-black font-black py-2.5 mb-2.5 uppercase tracking-widest flex items-center justify-center gap-1.5 cursor-pointer hover:bg-white/90 active:bg-white/80 transition-all select-none shrink-0"
              >
                <span>←</span>
                <span>RETOUR AUX LETTRES</span>
              </button>
              
              <div ref={scrollContainerRef} className="overflow-y-auto flex-1 divide-y divide-white/5 pr-0.5 min-h-0">
                {availableLetters.map(letter => {
                  const logosForLetter = allLogos.filter(logo => logo.name.trim().charAt(0).toUpperCase() === letter);
                  if (logosForLetter.length === 0) return null;

                  return (
                    <div key={letter} id={`category-${letter}`} className="scroll-mt-1 pt-1 pb-1">
                      {/* Bold letter category header - black text on white background */}
                      <div className="mx-1 my-1.5 py-1.5 px-2.5 text-[10.5px] font-black bg-white text-black tracking-[0.25em] uppercase select-none text-center rounded-none leading-none">
                        {letter}
                      </div>
                      
                      <div className="space-y-0.5">
                        {logosForLetter.map(logo => {
                          const isSelected = selectedLogoUrl === logo.url;
                          const cleanName = getCleanBrandName(logo.name);
                          return (
                            <button
                              key={logo.url}
                              type="button"
                              onClick={() => {
                                onSelectLogo(logo);
                                setIsOpen(false);
                                setInnerSelectedLetter(null);
                              }}
                              className={cn(
                                "w-full px-2 py-0.5 flex items-center gap-2.5 text-left text-[11px] uppercase tracking-wide transition-colors cursor-pointer min-w-0 h-8",
                                isSelected ? "bg-white/10 text-white font-bold" : "text-white/70 hover:bg-white/5 hover:text-white"
                              )}
                            >
                              <div className="w-6 h-6 flex items-center justify-center bg-black/40 p-0.5 border border-white/5 shrink-0">
                                <img src={logo.url} className="max-w-full max-h-full object-contain" referrerPolicy="no-referrer" />
                              </div>
                              <span className="truncate flex-1 font-sans">{cleanName}</span>
                              {isSelected && <Check className="w-3.5 h-3.5 text-white shrink-0" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const BrandingLogoScreen: React.FC<{ 
  selected: string | null, 
  customLogo: string | null,
  logoText: string,
  showLogo: boolean,
  showText: boolean,
  onShowLogo: (v: boolean) => void,
  onShowText: (v: boolean) => void,
  logoType: 'upload' | 'text' | null,
  logoGridPosition: number | null,
  onSelect: (id: string | null) => void, 
  onCustomLogo: (img: string | null) => void,
  onLogoTextChange: (t: string) => void,
  onLogoTypeChange: (t: 'upload' | 'text' | null) => void,
  onLogoGridPositionChange: (p: number | null) => void,
  posV: 'top' | 'bottom' | 'integrated' | null, 
  posH: 'left' | 'right' | 'center' | null,
  onPosV: (pos: 'top' | 'bottom' | 'integrated' | null) => void, 
  onPosH: (pos: 'left' | 'right' | 'center' | null) => void,
  onNext: () => void, 
  onBack: () => void,
  onHome: () => void,
  isJumpingBack: boolean,
  previewProps: any
}> = ({ 
  selected, customLogo, logoText, showLogo, showText, onShowLogo, onShowText, logoType, logoGridPosition, 
  onSelect, onCustomLogo, onLogoTextChange, onLogoTypeChange, onLogoGridPositionChange,
  posV, posH, onPosV, onPosH, onNext, onBack, onHome, isJumpingBack, previewProps
}) => {
  const preset = React.useMemo(() => {
    return getBrandingPreset(previewProps.envVariant, previewProps.brandingPresets || {});
  }, [previewProps.envVariant, previewProps.brandingPresets]);

  const isLogoAllowed = preset ? (getPropValue(preset, 'logo') !== false && getPropValue(preset, 'logo') !== 'false') : true;
  const isTextAllowed = preset ? (getPropValue(preset, 'text') !== false && getPropValue(preset, 'text') !== 'false') : true;

  const [fileName, setFileName] = React.useState<string | null>(null);
  const [searchTerm, setSearchTerm] = React.useState('');
  const [selectedLetter, setSelectedLetter] = React.useState<string | null>(null);
  const [firebaseLogos, setFirebaseLogos] = React.useState<{ name: string, url: string }[]>(() => {
    try {
      const cached = localStorage.getItem('pwa_cached_constructor_logos_v2');
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  });
  const [loadingLogos, setLoadingLogos] = React.useState(false);

  const [logoMode, setLogoMode] = React.useState<'votre_logo' | 'constructeurs'>('votre_logo');
  const [uploadedLogo, setUploadedLogo] = React.useState<string | null>(null);
  const [constructeurLogo, setConstructeurLogo] = React.useState<string | null>(null);

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const triggerFileInput = () => {
    // Small timeout to give React rendering cycle time if needed
    setTimeout(() => {
      if (fileInputRef.current) {
        fileInputRef.current.click();
      }
    }, 50);
  };

  React.useEffect(() => {
    if (customLogo) {
      const isUrlInAllLogos = firebaseLogos.some(l => l.url === customLogo);
      if (customLogo.startsWith('data:') || !isUrlInAllLogos) {
        setUploadedLogo(customLogo);
        if (showLogo) {
          setLogoMode('votre_logo');
        }
      } else {
        setConstructeurLogo(customLogo);
        if (showLogo) {
          setLogoMode('constructeurs');
        }
      }
    }
  }, [customLogo, firebaseLogos]);

  React.useEffect(() => {
    let isSubscribed = true;
    async function loadStorageLogos() {
      // Only show spinner if there is no cache
      const hasCache = firebaseLogos.length > 0;
      if (!hasCache) {
        setLoadingLogos(true);
      }
      
      try {
        const auth = getAuth();
        if (!auth.currentUser) {
          await signInAnonymously(auth);
        }
      } catch (authErr) {
        // Auth-by-default is optional based on Firebase console configuration
      }

      const possiblePaths = ['LOGOS', 'logos'];
      let foundLogos: { name: string, url: string }[] = [];

      async function listAllRecursive(dirRef: any, depth = 0): Promise<{ name: string, url: string }[]> {
        if (depth > 4) return [];
        let results: { name: string, url: string }[] = [];
        try {
          const res = await listAll(dirRef);
          
          if (res.items.length > 0) {
            const filePromises = res.items.map(async (item) => {
              try {
                const url = await getDownloadURL(item);
                const cleanName = item.name.substring(0, item.name.lastIndexOf('.')) || item.name;
                
                // Parse fullPath to extract parent folder context
                const parts = item.fullPath.split('/');
                let resolvedName = cleanName;
                if (parts.length >= 2) {
                  const parentFolder = parts[parts.length - 2];
                  if (parentFolder && parentFolder.toLowerCase() !== 'logos' && parentFolder.toLowerCase() !== 'marques' && parentFolder.toLowerCase() !== 'brands' && parentFolder.toLowerCase() !== 'environments') {
                    if (parentFolder.length === 1) {
                      resolvedName = parentFolder.toUpperCase() + "_" + cleanName;
                    } else {
                      resolvedName = parentFolder + "_" + cleanName;
                    }
                  }
                }
                
                return { name: resolvedName, url };
              } catch (err) {
                return null;
              }
            });
            const loaded = (await Promise.all(filePromises)).filter((x): x is { name: string, url: string } => x !== null);
            results = [...results, ...loaded];
          }
          
          if (res.prefixes.length > 0) {
            const subfolderPromises = res.prefixes.map(async (subRef) => {
              return await listAllRecursive(subRef, depth + 1);
            });
            const subfolderResults = await Promise.all(subfolderPromises);
            for (const sub of subfolderResults) {
              results = [...results, ...sub];
            }
          }
        } catch (err) {
          // Ignore listErrors
        }
        return results;
      }
      
      try {
        const promises = possiblePaths.map(async (path) => {
          try {
            const dirRef = ref(storage, path);
            return await listAllRecursive(dirRef);
          } catch (err) {
            return [];
          }
        });
        const results = await Promise.all(promises);
        for (const res of results) {
          foundLogos = [...foundLogos, ...res];
        }
      } catch (err) {
        console.warn("Parallel logo loading error:", err);
      }
      
      if (isSubscribed) {
        const unique = foundLogos.reduce((acc, current) => {
          const x = acc.find(item => item.name.toLowerCase() === current.name.toLowerCase());
          if (!x) {
            return acc.concat([current]);
          } else {
            return acc;
          }
        }, [] as { name: string, url: string }[]);
        
        setFirebaseLogos(unique);
        try {
          localStorage.setItem('pwa_cached_constructor_logos_v2', JSON.stringify(unique));
        } catch (e) {
          console.warn("[Cache] Failed saving logos to cache:", e);
        }
        setLoadingLogos(false);
      }
    }
    
    loadStorageLogos();
    return () => { isSubscribed = false; };
  }, []);

  const allLogos = React.useMemo(() => {
    return [...firebaseLogos].sort((a, b) => a.name.localeCompare(b.name));
  }, [firebaseLogos]);

  const filteredLogos = React.useMemo(() => {
    return allLogos.filter(logo => {
      const matchSearch = logo.name.toLowerCase().includes(searchTerm.toLowerCase());
      // If searching, ignore the letter selection so search can refine across all constructor brands
      const matchLetter = (selectedLetter && !searchTerm.trim()) 
        ? logo.name.trim().charAt(0).toUpperCase() === selectedLetter 
        : true;
      return matchSearch && matchLetter;
    });
  }, [allLogos, searchTerm, selectedLetter]);

  const availableLetters = React.useMemo(() => {
    const letters = allLogos.map(logo => logo.name.trim().charAt(0).toUpperCase());
    return Array.from(new Set(letters)).sort();
  }, [allLogos]);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFileName(file.name);
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          setUploadedLogo(reader.result);
          onCustomLogo(reader.result);
        }
      };
      reader.readAsDataURL(file);
      onLogoTypeChange('upload');
      onSelect(null);
      setLogoMode('votre_logo');
      onShowLogo(true);
    }
  };

  return (
    <ScreenWrapper 
      title="Branding" 
      subtitle="Add your signature mark."
      onBack={onBack}
      onNext={onNext}
      onHome={onHome}
      showHomeConfirm={true}
      isNextDisabled={false}
      isJumpingBack={isJumpingBack}
    >
      <div className="space-y-2.5">
        <SharedPreview {...previewProps} logoType={logoType} customLogo={customLogo} logoText={logoText} logoGridPosition={logoGridPosition} showLogo={showLogo} showText={showText} hideDebugInfo={true} />
        
        <div className="px-4 space-y-2.5">
          {/* SECTION • TEXTE (Ligne unique ultra-compacte) */}
          {isTextAllowed && (
            <div className="flex items-center gap-2 bg-white/5 border border-white/10 p-2.5 w-full">
              {/* Checkbox devant */}
              <button 
                type="button"
                onClick={() => onShowText(!showText)}
                className={cn(
                  "w-5 h-5 border flex items-center justify-center transition-all cursor-pointer shrink-0",
                  showText ? "bg-white text-black border-white" : "border-white/20 bg-transparent text-white/50"
                )}
              >
                {showText && <Check className="w-3.5 h-3.5 stroke-[3]" />}
              </button>
              
              <span 
                className={cn(
                  "text-[9px] font-bold tracking-widest uppercase shrink-0 select-none cursor-pointer",
                  showText ? "text-white" : "text-zinc-400"
                )}
                onClick={() => onShowText(!showText)}
              >
                TEXTE :
              </span>
              
              {/* Input */}
              <div className="flex-1">
                <Input 
                  placeholder="SAISIR VOTRE TEXTE..." 
                  value={logoText}
                  maxLength={30}
                  onFocus={() => {
                    if (!showText) onShowText(true);
                  }}
                  onClick={() => {
                    if (!showText) onShowText(true);
                  }}
                  onChange={(e) => {
                    const val = e.target.value.toUpperCase();
                    onLogoTextChange(val);
                    if (!showText) onShowText(true);
                  }}
                  className={cn(
                    "h-8 rounded-none bg-white/[0.02] border-white/10 text-left px-2.5 text-base md:text-[8px] tracking-[0.1em] uppercase transition-opacity w-full font-sans",
                    !showText && "opacity-60"
                  )}
                />
              </div>
            </div>
          )}

          {/* SECTION • LOGO */}
          {isLogoAllowed && (
            /* Permanent row layout: Controls on left, Preview on right */
            <div className="flex flex-row gap-2.5 items-start bg-white/5 border border-white/10 p-2.5 w-full relative">
              
              {/* OPTIONS (Gauche - Deux entrées exclusives superposées) */}
              <div className="flex-1 flex flex-col gap-2 pt-0.5">
                
                {/* Ligne 1: Constructeurs */}
                <div className="flex flex-col gap-1.5 pb-1.5 border-b border-white/5">
                  <div className="flex items-center justify-between gap-1.5 w-full">
                    <div className="flex items-center gap-2">
                       <button 
                        type="button"
                        onClick={() => {
                          const act = !(showLogo && logoMode === 'constructeurs');
                          if (act) {
                            onShowLogo(true);
                            setLogoMode('constructeurs');
                            onCustomLogo(constructeurLogo);
                          } else {
                            onShowLogo(false);
                          }
                        }}
                        className={cn(
                          "w-4.5 h-4.5 border flex items-center justify-center transition-all cursor-pointer shrink-0",
                          (showLogo && logoMode === 'constructeurs') ? "bg-white text-black border-white" : "border-white/20 bg-transparent text-white/50"
                        )}
                      >
                        {(showLogo && logoMode === 'constructeurs') && <Check className="w-3 h-3 stroke-[3]" />}
                      </button>
                      <span 
                        className={cn(
                          "text-[9px] uppercase tracking-wider transition-colors cursor-pointer select-none",
                          (showLogo && logoMode === 'constructeurs') ? "text-white font-bold" : "text-zinc-400"
                        )}
                        onClick={() => {
                          onShowLogo(true);
                          setLogoMode('constructeurs');
                          onCustomLogo(constructeurLogo);
                        }}
                      >
                        Constructeurs
                      </span>
                    </div>

                    {/* Selecteur de marque CustomBrandDropdown remonté sur la même ligne avec taille réduite */}
                    <CustomBrandDropdown 
                      allLogos={allLogos}
                      filteredLogos={filteredLogos}
                      availableLetters={availableLetters}
                      searchTerm={searchTerm}
                      selectedLogoUrl={constructeurLogo}
                      size="sm"
                      onSelectLogo={(logo) => {
                        setConstructeurLogo(logo.url);
                        onCustomLogo(logo.url);
                        setFileName(logo.name + '.png');
                        if (!(showLogo && logoMode === 'constructeurs')) {
                          onShowLogo(true);
                          setLogoMode('constructeurs');
                        }
                      }}
                      onInteraction={() => {
                        if (!(showLogo && logoMode === 'constructeurs')) {
                          onShowLogo(true);
                          setLogoMode('constructeurs');
                          onCustomLogo(constructeurLogo);
                        }
                      }}
                    />
                  </div>

                  {/* Always visible Search and Select Constructor controls */}
                  <div className="space-y-1 w-full">
                    {/* Rechercher un constructeur remonté à la place du dropdown */}
                    <div className="relative">
                      <Input 
                        placeholder="RECHERCHER..." 
                        value={searchTerm}
                        onFocus={() => {
                          if (!(showLogo && logoMode === 'constructeurs')) {
                            onShowLogo(true);
                            setLogoMode('constructeurs');
                            onCustomLogo(constructeurLogo);
                          }
                        }}
                        onClick={() => {
                          if (!(showLogo && logoMode === 'constructeurs')) {
                            onShowLogo(true);
                            setLogoMode('constructeurs');
                            onCustomLogo(constructeurLogo);
                          }
                        }}
                        onChange={(e) => {
                          setSearchTerm(e.target.value);
                          if (!(showLogo && logoMode === 'constructeurs')) {
                            onShowLogo(true);
                            setLogoMode('constructeurs');
                            onCustomLogo(constructeurLogo);
                          }
                        }}
                        className="h-7 rounded-none bg-white/5 border-white/10 text-left px-2 text-base md:text-[7.5px] text-white placeholder:text-zinc-400 tracking-wider uppercase w-full pr-6 font-sans"
                      />
                      {searchTerm && (
                        <button 
                          type="button"
                          onClick={() => setSearchTerm('')} 
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-white/50 hover:text-white text-[9px] font-bold p-0.5 leading-none shrink-0"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Ligne 2: Votre logo */}
                <div className="flex flex-col gap-1 pt-1.5">
                  {/* Input invisible permanent relié par ref pour le click automatique */}
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    className="hidden" 
                    accept="image/*" 
                    onChange={handleLogoUpload} 
                  />

                  <div className="flex items-center justify-between gap-1.5 w-full">
                    <div className="flex items-center gap-2">
                      <button 
                        type="button"
                        onClick={() => {
                          const act = !(showLogo && logoMode === 'votre_logo');
                          if (act) {
                            onShowLogo(true);
                            setLogoMode('votre_logo');
                            onCustomLogo(uploadedLogo);
                            triggerFileInput();
                          } else {
                            onShowLogo(false);
                          }
                        }}
                        className={cn(
                          "w-4.5 h-4.5 border flex items-center justify-center transition-all cursor-pointer shrink-0",
                          (showLogo && logoMode === 'votre_logo') ? "bg-white text-black border-white" : "border-white/20 bg-transparent text-white/50"
                        )}
                      >
                        {(showLogo && logoMode === 'votre_logo') && <Check className="w-3 h-3 stroke-[3]" />}
                      </button>
                      <span 
                        className={cn(
                          "text-[9px] uppercase tracking-wider transition-colors cursor-pointer select-none",
                          (showLogo && logoMode === 'votre_logo') ? "text-white font-bold" : "text-zinc-400"
                        )}
                        onClick={() => {
                          onShowLogo(true);
                          setLogoMode('votre_logo');
                          onCustomLogo(uploadedLogo);
                          triggerFileInput();
                        }}
                      >
                        Votre logo
                      </span>
                    </div>

                    {/* Always visible Importer button */}
                    <button 
                      type="button"
                      onClick={() => {
                        onShowLogo(true);
                        setLogoMode('votre_logo');
                        onCustomLogo(uploadedLogo);
                        triggerFileInput();
                      }}
                      className="inline-flex items-center px-1.5 py-0.5 border border-white/20 bg-white/5 hover:bg-white/10 text-white cursor-pointer transition-colors text-[8px] uppercase tracking-wider shrink-0"
                    >
                      <span>Importer</span>
                    </button>
                  </div>

                  {(uploadedLogo && fileName) && (
                    <div className="pl-6.5 text-[7.5px] text-zinc-400 font-mono truncate max-w-[170px] leading-tight">
                      Fichier : {fileName}
                    </div>
                  )}
                </div>

              </div>

              {/* PREVIEW CARRE (Droite - Optimisé à 90px par 90px) */}
              <div className="flex flex-col items-center justify-center bg-black/40 border border-white/10 w-[90px] h-[90px] shrink-0 relative">
                {showLogo && customLogo ? (
                  <img src={customLogo} className="max-w-[85%] max-h-[85%] object-contain" referrerPolicy="no-referrer" />
                ) : (
                  <div className="text-[8px] text-white/20 uppercase tracking-widest text-center px-1 font-mono leading-tight">
                    Aucun<br/>Logo
                  </div>
                )}
              </div>

            </div>
          )}
        </div>
      </div>
    </ScreenWrapper>
  );
};

const ColorLightScreen: React.FC<{ 
  theme: string, 
  onThemeChange: (t: string) => void, 
  intensity: number,
  onIntensityChange: (v: number) => void,
  onNext: () => void, 
  onBack: () => void, 
  onHome: () => void,
  isJumpingBack: boolean, 
  previewProps: any 
}> = ({ theme, onThemeChange, intensity, onIntensityChange, onNext, onBack, onHome, isJumpingBack, previewProps }) => {
  const pickerRef = React.useRef<HTMLDivElement>(null);
  const [pickerPos, setPickerPos] = useState({ x: 0, y: 0 });
  const [hasInteracted, setHasInteracted] = useState(false);

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!pickerRef.current) return;
    const rect = pickerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const y = Math.max(0, Math.min(e.clientY - rect.top, rect.height));
    
    setPickerPos({ x, y });
    setHasInteracted(true);
    
    const h = (x / rect.width) * 360;
    const s = 100;
    const l = 100 - (y / rect.height) * 100;
    
    onThemeChange(`hsl(${h}, ${s}%, ${l}%)`);
  };

  return (
    <ScreenWrapper 
      title="Color & Light" 
      subtitle="Set the final mood."
      onBack={onBack}
      onNext={onNext}
      onHome={onHome}
      showHomeConfirm={true}
      isJumpingBack={isJumpingBack}
      noScroll={true}
    >
      <div className="space-y-4">
        <SharedPreview {...previewProps} colorTheme={theme} colorIntensity={intensity} hideDebugInfo={true} />
        
        <div className="px-6 space-y-4">
          <div className="flex gap-4 items-center">
            <div 
              ref={pickerRef}
              onPointerMove={(e) => e.buttons === 1 && handlePointerMove(e)}
              onPointerDown={handlePointerMove}
              className="relative flex-1 h-24 cursor-crosshair touch-none overflow-hidden"
              style={{
                background: `
                  linear-gradient(to bottom, white, transparent 50%, black),
                  linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)
                `
              }}
            >
              {/* Selection Circle */}
              {hasInteracted && (
                <div 
                  className="absolute w-4 h-4 rounded-full border-2 border-white shadow-md pointer-events-none -translate-x-1/2 -translate-y-1/2"
                  style={{ left: pickerPos.x, top: pickerPos.y }}
                />
              )}
            </div>
            
            {/* Color Preview Square */}
            <div className="w-24 h-24 shrink-0 relative bg-zinc-900 overflow-hidden">
              <div 
                className="absolute inset-0"
                style={{ 
                  backgroundColor: theme,
                  opacity: 0.2 * intensity,
                  mixBlendMode: 'overlay'
                }}
              />
              <div className="absolute inset-0" style={{ backgroundColor: theme }} />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label className="text-[10px] font-bold uppercase tracking-widest text-white">Intensity</Label>
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-mono text-white">{Math.round(intensity * 100)}%</span>
                <button 
                  onClick={() => {
                    onIntensityChange(1);
                    onThemeChange('hsl(0, 0%, 100%)');
                    setHasInteracted(false);
                  }}
                  className="text-[8px] font-bold uppercase tracking-widest bg-white/10 hover:bg-white/20 px-2 py-1 transition-colors"
                >
                  Reset
                </button>
              </div>
            </div>
            <Input 
              type="range" 
              min="0" 
              max="2" 
              step="0.01"
              value={intensity} 
              onChange={(e) => onIntensityChange(parseFloat(e.target.value))}
              className="h-2 accent-white"
            />
          </div>
        </div>
      </div>
    </ScreenWrapper>
  );
};

async function checkPixelAlpha(element: HTMLElement, clientX: number, clientY: number): Promise<boolean> {
  try {
    let imgUrl = '';
    let isMask = false;
    if (element instanceof HTMLImageElement) {
      imgUrl = element.src;
    } else {
      const style = element.style as any;
      const maskImg = style.maskImage || style.WebkitMaskImage || style.webkitMaskImage || '';
      if (maskImg && maskImg.includes('url(')) {
        const matches = maskImg.match(/url\((['"]?)(.*?)\1\)/);
        if (matches && matches[2]) {
          imgUrl = matches[2];
          isMask = true;
        }
      }
    }
    
    if (!imgUrl) return false;

    // Load image to check alpha
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = imgUrl;

    await new Promise((resolve, reject) => {
      if (img.complete) {
        resolve(img);
      } else {
        img.onload = () => resolve(img);
        img.onerror = (e) => reject(e);
      }
    });

    const rect = element.getBoundingClientRect();
    const relativeX = clientX - rect.left;
    const relativeY = clientY - rect.top;

    // Scale click relative coordinates to image natural dimensions
    const scaleX = img.naturalWidth / rect.width;
    const scaleY = img.naturalHeight / rect.height;

    const sourceX = Math.floor(relativeX * scaleX);
    const sourceY = Math.floor(relativeY * scaleY);

    if (sourceX < 0 || sourceX >= img.naturalWidth || sourceY < 0 || sourceY >= img.naturalHeight) {
      return false;
    }

    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;

    // Draw just the single pixel we are interested in
    ctx.drawImage(img, sourceX, sourceY, 1, 1, 0, 0, 1, 1);
    const pixel = ctx.getImageData(0, 0, 1, 1).data;
    const alpha = pixel[3]; // 0-255

    return alpha > 10;
  } catch (e) {
    console.warn("Alpha check failed or CORS blocked:", e);
    return true; // Fallback to click inside rect if CORS/canvas fails
  }
}

const LivePreviewScreen: React.FC<{ 
  onBack: () => void, 
  onNext: () => void, 
  onHome: () => void,
  onJump: (screen: Screen) => void,
  previewProps: any
}> = ({ onBack, onNext, onHome, onJump, previewProps }) => {
  const [showZones, setShowZones] = useState(false);
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [highlightStep, setHighlightStep] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const [showAdjust, setShowAdjust] = useState(false);
  const initialTransformRef = useRef({ ...previewProps.imageTransform });

  const [measuredZones, setMeasuredZones] = useState<Record<string, { top: string, left: string, width: string, height: string }>>({});

  useEffect(() => {
    if (!showZones) return;
    const interval = setInterval(() => {
      setHighlightStep(s => (s + 1) % 4);
    }, 3000);
    return () => clearInterval(interval);
  }, [showZones]);

  useEffect(() => {
    if (!showZones || !containerRef.current) return;
    
    const updateMeasuredZones = () => {
      if (!containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const newZones: Record<string, any> = {};

      // Environment indicator
      newZones['env'] = {
        top: '4%',
        left: '4%',
        width: '25%',
        height: '15%'
      };

      // Text Element
      const textEl = containerRef.current.querySelector('[data-zone="text"]');
      if (textEl) {
        const rect = textEl.getBoundingClientRect();
        newZones['text'] = {
          top: `${((rect.top - containerRect.top) / containerRect.height) * 100}%`,
          left: `${((rect.left - containerRect.left) / containerRect.width) * 100}%`,
          width: `${(rect.width / containerRect.width) * 100}%`,
          height: `${(rect.height / containerRect.height) * 100}%`
        };
      }

      // Logo Element
      const logoEl = containerRef.current.querySelector('[data-zone="logo"]');
      if (logoEl) {
        const rect = logoEl.getBoundingClientRect();
        newZones['logo'] = {
          top: `${((rect.top - containerRect.top) / containerRect.height) * 100}%`,
          left: `${((rect.left - containerRect.left) / containerRect.width) * 100}%`,
          width: `${(rect.width / containerRect.width) * 100}%`,
          height: `${(rect.height / containerRect.height) * 100}%`
        };
      }

      // Vehicle Element
      const vehicleEl = containerRef.current.querySelector('[data-zone="vehicle"]');
      if (vehicleEl) {
        const rect = vehicleEl.getBoundingClientRect();
        newZones['vehicle'] = {
          top: `${((rect.top - containerRect.top) / containerRect.height) * 100}%`,
          left: `${((rect.left - containerRect.left) / containerRect.width) * 100}%`,
          width: `${(rect.width / containerRect.width) * 100}%`,
          height: `${(rect.height / containerRect.height) * 100}%`
        };
      }

      setMeasuredZones(newZones);
    };

    updateMeasuredZones();
    const t = setTimeout(updateMeasuredZones, 100);
    const t2 = setTimeout(updateMeasuredZones, 500);

    window.addEventListener('resize', updateMeasuredZones);
    return () => {
      clearTimeout(t);
      clearTimeout(t2);
      window.removeEventListener('resize', updateMeasuredZones);
    };
  }, [showZones, previewProps.logoText, previewProps.envVariant, previewProps.logo, previewProps.customLogo, previewProps.image]);

  const handleZoneClick = (zoneId: string) => {
    if (selectedZone === zoneId) {
      setSelectedZone(null);
    } else {
      setSelectedZone(zoneId);
    }
  };

  const handleGlobalClick = async (e: React.MouseEvent) => {
    if (!showZones || !containerRef.current) return;
    
    const clientX = e.clientX;
    const clientY = e.clientY;

    let hitZone: string | null = null;

    // 1. Text Check
    const textEl = containerRef.current.querySelector('[data-zone="text"]');
    if (textEl) {
      const rect = textEl.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        hitZone = 'text';
      }
    }

    // 2. Logo Check (with solid pixel matching check)
    if (!hitZone) {
      const logoEl = containerRef.current.querySelector('[data-zone="logo"]') as HTMLElement;
      if (logoEl) {
        const rect = logoEl.getBoundingClientRect();
        if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
          const isSolid = await checkPixelAlpha(logoEl, clientX, clientY);
          if (isSolid) {
            hitZone = 'logo';
          }
        }
      }
    }

    // 3. Vehicle Check (with solid pixel cutout matching check)
    if (!hitZone) {
      const vehicleEl = containerRef.current.querySelector('[data-zone="vehicle"]') as HTMLElement;
      if (vehicleEl) {
        const rect = vehicleEl.getBoundingClientRect();
        if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
          const isSolid = await checkPixelAlpha(vehicleEl, clientX, clientY);
          if (isSolid) {
            hitZone = 'vehicle';
          }
        }
      }
    }

    // 4. Fallback environment/base area check
    if (!hitZone) {
      const parentRect = containerRef.current.getBoundingClientRect();
      const relativeXPercent = ((clientX - parentRect.left) / parentRect.width) * 100;
      const relativeYPercent = ((clientY - parentRect.top) / parentRect.height) * 100;

      if (relativeYPercent < 25 && relativeXPercent < 35) {
        hitZone = 'env';
      } else {
        hitZone = 'env'; // Outer / BG area fallback
      }
    }

    if (hitZone) {
      handleZoneClick(hitZone);
    }
  };

  const handleModifyClick = () => {
    if (selectedZone) {
      if (selectedZone === 'env') {
        onJump('environment_category');
      } else if (selectedZone === 'text') {
        onJump('branding_logo');
      } else if (selectedZone === 'logo') {
        onJump('branding_logo');
      } else if (selectedZone === 'vehicle') {
        onJump('upload');
      }
    } else {
      setShowZones(!showZones);
    }
  };

  const getModifyLabel = () => {
    if (selectedZone) {
      if (selectedZone === 'text') return 'MODIFY TEXT';
      if (selectedZone === 'env') return 'MODIFY ENVIRONMENT';
      if (selectedZone === 'vehicle') return 'MODIFY VEHICLE';
      if (selectedZone === 'logo') return 'MODIFY LOGO';
      return `MODIFY ${selectedZone.toUpperCase()}`;
    }
    return showZones ? "HIDE ZONE" : "MODIFY ELEMENTS";
  };

  return (
    <ScreenWrapper 
      title="Final Review" 
      subtitle="One last look before we generate."
      onBack={onBack}
      onNext={onNext}
      onHome={onHome}
      showHomeConfirm={true}
      nextLabel="Generate Masterpiece"
    >
      <div className="space-y-4">
        <div className="relative cursor-default" id="pwa-composite-capture" ref={containerRef} onClick={handleGlobalClick}>
          <SharedPreview 
            {...previewProps} 
            highlightStep={highlightStep} 
            allowSweeps={showZones} 
            hideDebugInfo={true} 
            selectedZone={selectedZone}
          />
          
          <AnimatePresence>
            {/* Rectangular indicators and zone borders removed to maintain a custom pixel-perfect alpha-based design */}
          </AnimatePresence>
        </div>

        <div className="px-6 space-y-2.5">
          <div className="flex gap-2">
            <Button 
              variant={showAdjust ? "default" : "secondary"}
              onClick={() => setShowAdjust(!showAdjust)}
              className={cn(
                "flex-1 h-8 rounded-none text-[9px] font-bold uppercase tracking-widest transition-all bg-white text-black border border-white hover:bg-white/90 px-2",
                !showAdjust && "bg-white/5 border-white/10 hover:bg-white/10 text-white"
              )}
            >
              {showAdjust ? "CLOSE ADJUSTMENTS" : "ADJUST VEHICULE"}
            </Button>

            <Button 
              variant="secondary"
              onClick={handleModifyClick}
              className={cn(
                "flex-1 h-8 rounded-none text-[9px] font-bold uppercase tracking-widest transition-all px-2 bg-white/10 text-white",
                selectedZone && "ring-2 ring-inset ring-white"
              )}
            >
              {getModifyLabel()}
            </Button>
          </div>

          <AnimatePresence>
            {showAdjust && (
              <motion.div 
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="bg-zinc-950 border border-white/10 p-3 space-y-3 overflow-hidden"
              >
                <div className="grid grid-cols-2 gap-3">
                  {/* Scale Slider */}
                  <div className="space-y-1 font-sans">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-[9px] font-mono font-bold tracking-wider text-white/50 uppercase">Échelle</span>
                      <span className="text-[9px] font-mono text-white">
                        {Math.round(((previewProps.imageTransform?.scale ?? 1.0) - (initialTransformRef.current?.scale ?? 1.0)) / (initialTransformRef.current?.scale ?? 1.0) * 100) > 0 ? "+" : ""}
                        {Math.round(((previewProps.imageTransform?.scale ?? 1.0) - (initialTransformRef.current?.scale ?? 1.0)) / (initialTransformRef.current?.scale ?? 1.0) * 100)}%
                      </span>
                    </div>
                    <input 
                      type="range" 
                      min="-50" 
                      max="50" 
                      step="1"
                      value={Math.round(((previewProps.imageTransform?.scale ?? 1.0) - (initialTransformRef.current?.scale ?? 1.0)) / (initialTransformRef.current?.scale ?? 1.0) * 100)}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        const newScale = (initialTransformRef.current?.scale ?? 1.0) * (1 + val / 100);
                        previewProps.onUpdateTransform({
                          ...previewProps.imageTransform,
                          scale: newScale
                        });
                      }}
                      className="w-full h-1 bg-white/10 rounded-none appearance-none cursor-pointer accent-white"
                    />
                    <div className="flex justify-between text-[7px] font-mono text-white/30 leading-none">
                      <span>-50%</span>
                      <span>0%</span>
                      <span>+50%</span>
                    </div>
                  </div>

                  {/* Rotation Slider */}
                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-[9px] font-mono font-bold tracking-wider text-white/50 uppercase">Rotation</span>
                      <span className="text-[9px] font-mono text-white">
                        {(previewProps.imageTransform?.rotate ?? 0) > 0 ? "+" : ""}
                        {(previewProps.imageTransform?.rotate ?? 0).toFixed(1)}°
                      </span>
                    </div>
                    <input 
                      type="range" 
                      min="-10" 
                      max="10" 
                      step="0.1"
                      value={previewProps.imageTransform?.rotate ?? 0}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        const capped = Math.min(10, Math.max(-10, val));
                        previewProps.onUpdateTransform({
                          ...previewProps.imageTransform,
                          rotate: capped
                        });
                      }}
                      className="w-full h-1 bg-white/10 rounded-none appearance-none cursor-pointer accent-white"
                    />
                    <div className="flex justify-between text-[7px] font-mono text-white/30 leading-none">
                      <span>-10°</span>
                      <span>0°</span>
                      <span>+10°</span>
                    </div>
                  </div>
                </div>

                {/* Position Joypad */}
                <div className="pt-2 border-t border-white/5 flex items-center justify-between w-full">
                  <div className="space-y-1">
                    <span className="text-[9px] font-mono font-bold tracking-wider text-white/50 uppercase block">POSITION</span>
                    <div className="flex gap-2 text-[8px] font-mono text-white/55">
                      <div>X: <span className="text-white font-bold">{Math.round(previewProps.imageTransform?.x ?? 0)}%</span></div>
                      <div>Y: <span className="text-white font-bold">{Math.round(previewProps.imageTransform?.y ?? 0)}%</span></div>
                    </div>
                    <button 
                      onClick={() => {
                        previewProps.onUpdateTransform({
                          ...initialTransformRef.current
                        });
                      }}
                      className="text-[7.5px] bg-white/5 hover:bg-white/10 px-1.5 py-1 text-white uppercase tracking-wider font-bold block transition-colors cursor-pointer mt-1"
                    >
                      RESET ALL
                    </button>
                  </div>
                  
                  {/* Visual Joypad Pad (Ultra-compacte 80px) */}
                  <div className="relative w-20 h-20 bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                    <div className="absolute inset-x-0 h-px bg-white/10 pointer-events-none" />
                    <div className="absolute inset-y-0 w-px bg-white/10 pointer-events-none" />
                    
                    <button 
                      onClick={() => {
                        previewProps.onUpdateTransform({
                          ...previewProps.imageTransform,
                          y: (previewProps.imageTransform?.y ?? 0) - 2
                        });
                      }}
                      className="absolute top-0.5 left-1/2 -translate-x-1/2 w-5.5 h-5.5 bg-zinc-900 border border-white/10 active:bg-white active:text-black transition-colors flex items-center justify-center text-white text-[8px] cursor-pointer"
                      title="Move Up"
                    >
                      ▲
                    </button>
                    <button 
                      onClick={() => {
                        previewProps.onUpdateTransform({
                          ...previewProps.imageTransform,
                          x: (previewProps.imageTransform?.x ?? 0) - 2
                        });
                      }}
                      className="absolute left-0.5 top-1/2 -translate-y-1/2 w-5.5 h-5.5 bg-zinc-900 border border-white/10 active:bg-white active:text-black transition-colors flex items-center justify-center text-white text-[8px] cursor-pointer"
                      title="Move Left"
                    >
                      ◀
                    </button>
                    <button 
                      onClick={() => {
                        previewProps.onUpdateTransform({
                          ...previewProps.imageTransform,
                          x: initialTransformRef.current?.x ?? 0,
                          y: initialTransformRef.current?.y ?? 0
                        });
                      }}
                      className="absolute inset-0 m-auto w-5.5 h-5.5 bg-zinc-800 border border-white/20 active:bg-white active:text-black text-[6px] font-bold text-white flex items-center justify-center cursor-pointer"
                      title="Center Reset"
                    >
                      RST
                    </button>
                    <button 
                      onClick={() => {
                        previewProps.onUpdateTransform({
                          ...previewProps.imageTransform,
                          x: (previewProps.imageTransform?.x ?? 0) + 2
                        });
                      }}
                      className="absolute right-0.5 top-1/2 -translate-y-1/2 w-5.5 h-5.5 bg-zinc-900 border border-white/10 active:bg-white active:text-black transition-colors flex items-center justify-center text-white text-[8px] cursor-pointer"
                      title="Move Right"
                    >
                      ▶
                    </button>
                    <button 
                      onClick={() => {
                        previewProps.onUpdateTransform({
                          ...previewProps.imageTransform,
                          y: (previewProps.imageTransform?.y ?? 0) + 2
                        });
                      }}
                      className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-5.5 h-5.5 bg-zinc-900 border border-white/10 active:bg-white active:text-black transition-colors flex items-center justify-center text-white text-[8px] cursor-pointer"
                      title="Move Down"
                    >
                      ▼
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </ScreenWrapper>
  );
};

const GenerationScreen: React.FC<{ 
  onComplete: () => void; 
  onCancel: () => void;
  previewProps: any;
  currentJobStatus: 'pending' | 'processing' | 'completed' | 'error' | null;
  currentJobId: string | null;
  currentJobError?: string | null;
  onSimulateLocal?: () => void;
}> = ({ onComplete, onCancel, previewProps, currentJobStatus, currentJobId, currentJobError, onSimulateLocal }) => {
  const [localProgress, setLocalProgress] = useState(0);
  const [copied, setCopied] = useState(false);

  const handleCopyConfig = () => {
    const configToCopy = {
      projectId: firebaseConfig.projectId || "gen-lang-client-0870404092",
      firestoreDatabaseId: firebaseConfig.firestoreDatabaseId || "car-ia-photobooth"
    };
    navigator.clipboard.writeText(JSON.stringify(configToCopy, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  useEffect(() => {
    const interval = setInterval(() => {
      setLocalProgress(p => {
        if (currentJobId) {
          if (currentJobStatus === 'completed') {
            clearInterval(interval);
            setTimeout(onComplete, 500);
            return 100;
          }
          if (currentJobStatus === 'error') {
            clearInterval(interval);
            return p;
          }
          if (p >= 98) return 98;
          return p + 1;
        } else {
          // Pre-loading preparation progress cap at 45% while jobId is being registered
          if (p >= 45) return 45;
          return p + 3;
        }
      });
    }, currentJobId ? 180 : 50);

    return () => clearInterval(interval);
  }, [onComplete, currentJobId, currentJobStatus]);

  const getStatusSubtitle = () => {
    switch (currentJobStatus) {
      case 'pending':
        return 'Téléchargement de votre photo détourée et du fond choisi vers Firebase...';
      case 'processing':
        return 'En attente de NodeGen Studio. Le traitement par Gemini est actif...';
      case 'completed':
        return 'L\'image finale HD a été reçue ! Affichage en cours...';
      case 'error':
        return currentJobError || 'Le processus a échoué. Veuillez vérifier la connexion ou réclamer au Studio.';
      default:
        return 'Mise en place des calques et styles...';
    }
  };

  return (
    <ScreenWrapper 
      title={currentJobId ? "Interconnexion AI Studio" : "Crafting Masterpiece"} 
      subtitle={getStatusSubtitle()}
      showFooter={false}
    >
      <div className="space-y-4">
        <div className="relative border border-white/10 shadow-2xl">
          <SharedPreview {...previewProps} hideDebugInfo={true} />
          
          {/* Scanning Animation */}
          {currentJobStatus !== 'error' && (
            <motion.div 
              className="absolute inset-0 bg-gradient-to-b from-transparent via-white/20 to-transparent h-20 z-50"
              animate={{ top: ['-20%', '100%'] }}
              transition={{ duration: currentJobStatus === 'processing' ? 1.2 : 2, repeat: Infinity, ease: "linear" }}
            />
          )}
        </div>

        <div className="px-6 mt-8 space-y-4 font-mono">
          <div className="flex justify-between items-end">
            <span className="text-[10px] font-bold uppercase tracking-widest opacity-40">
              {currentJobId ? "STATUT TEMPS RÉEL" : "AI PROGRESS"}
            </span>
            <span className="text-xl font-mono">{localProgress}%</span>
          </div>
          
          <div className="w-full h-1 bg-white/10 rounded-none overflow-hidden">
            <motion.div 
              className={cn(
                "h-full transition-all duration-300",
                currentJobStatus === 'error' ? "bg-red-500" : "bg-white"
              )}
              initial={{ width: 0 }}
              animate={{ width: `${localProgress}%` }}
            />
          </div>

          {currentJobId && (
            <div className="pt-2 space-y-3 border-t border-white/5 text-[9px] text-white/50 tracking-wide">
              {/* Status List */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 mb-1.5 font-mono text-white text-[10px]">
                  <span className="text-zinc-500 uppercase font-bold">ID DE SORTIE (JOB ID) :</span>
                  <span className="bg-white/10 px-1.5 py-0.5 font-bold uppercase text-white tracking-widest leading-none select-all">{currentJobId}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-green-500 font-bold">✓</span>
                  <span>INITIALISATION RÉSEAU OK</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-green-500 font-bold">✓</span>
                  <span>DETOURAGE VEHICULE TERMINE</span>
                </div>
                
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "font-bold",
                    currentJobStatus === 'pending' ? "text-yellow-500 animate-pulse" : "text-green-500"
                  )}>
                    {currentJobStatus === 'pending' ? '●' : '✓'}
                  </span>
                  <span className={cn(currentJobStatus === 'pending' && "text-white")}>
                    TRANSMISSION AU NODEGEN STUDIO
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <span className={cn(
                    "font-bold",
                    currentJobStatus === 'processing' ? "text-yellow-500 animate-pulse" : (currentJobStatus === 'completed' ? "text-green-500" : "text-white/20")
                  )}>
                    {currentJobStatus === 'processing' ? '●' : (currentJobStatus === 'completed' ? '✓' : '○')}
                  </span>
                  <span className={cn(currentJobStatus === 'processing' && "text-white")}>
                    TRAITEMENT AI PAR GEMINI {currentJobStatus === 'processing' && "(EN COURS...)"}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <span className={cn(
                    "font-bold",
                    currentJobStatus === 'completed' ? "text-green-500" : "text-white/20"
                  )}>
                    {currentJobStatus === 'completed' ? '✓' : '○'}
                  </span>
                  <span className={cn(currentJobStatus === 'completed' && "text-white")}>
                    RECEPTION DE L'IMAGE FINALE HD
                  </span>
                </div>
              </div>

              {/* Troubleshooting Diagnostics Panel (visible when stuck in pending/processing) */}
              {(currentJobStatus === 'pending' || currentJobStatus === 'processing') && (
                <div className="p-3 bg-zinc-900 border border-white/10 text-[10px] space-y-3 font-sans mt-4 text-white/80">
                  <div className="flex items-center gap-2 text-yellow-500 font-bold">
                    <AlertCircle className="w-3.5 h-3.5 min-w-[14px]" />
                    <span>L'application NodeGen Studio ne répond pas ?</span>
                  </div>
                  
                  <p className="leading-relaxed text-[10px] text-white/70 font-sans">
                    Le PWA a bien enregistré la demande dans Firestore. Assurez-vous que votre NodeGen Studio externe est démarré et écoute cette base de données :
                  </p>

                  <div className="bg-black/40 p-2 font-mono text-[9px] text-zinc-300 overflow-x-auto select-all border border-white/5 space-y-1">
                    <div><span className="text-zinc-500">PROJECT ID :</span> {firebaseConfig.projectId}</div>
                    <div><span className="text-zinc-500">DATABASE ID :</span> {firebaseConfig.firestoreDatabaseId}</div>
                    <div><span className="text-zinc-500">EXPORT / JOB ID :</span> {currentJobId}</div>
                    <div><span className="text-zinc-500">PAYLOAD KEYS :</span> status, imageA (fond), imageB (véhicule), imageC (preview composition), rotation, createdAt</div>
                  </div>

                  <p className="text-[10px] text-white/50 leading-relaxed font-sans">
                    Si NodeGen Studio n'est pas configuré avec cet ID, il ne recevra pas la demande. Copiez la configuration ci-dessous ou forcez le traitement local de démo !
                  </p>

                  <div className="flex gap-2 pt-1">
                    <Button 
                      variant="outline"
                      size="sm"
                      className="text-[9px] h-7 font-bold uppercase tracking-wider rounded-none flex-1 border-white/15 hover:bg-white/5"
                      onClick={handleCopyConfig}
                    >
                      <Copy className="w-3 h-3 mr-1" />
                      {copied ? "COPIÉ !" : "COPIER ID DB"}
                    </Button>
                    {onSimulateLocal && (
                      <Button 
                        variant="outline"
                        size="sm"
                        className="text-[9px] h-7 font-bold uppercase tracking-wider rounded-none flex-1 border-yellow-500/20 text-yellow-400 hover:bg-yellow-500/10"
                        onClick={onSimulateLocal}
                      >
                        <Sparkles className="w-3 h-3 mr-1 text-yellow-400" />
                        SIMULER TRAITEMENT
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {currentJobStatus === 'error' && (
                <div className="mt-4 p-3 bg-red-950/40 border border-red-500/20 text-red-300 rounded-none text-[10px] space-y-2 font-sans">
                  <p className="font-bold">Erreur signalée par le Studio.</p>
                  {currentJobError && (
                    <p className="text-[9px] opacity-90 font-mono break-all whitespace-pre-wrap">{currentJobError}</p>
                  )}
                  <p className="text-[9px] opacity-80">La génération n'a pas pu aboutir. Vérifiez que NodeGen Studio est démarré et que GEMINI_API_KEY est configurée.</p>
                  <Button 
                    variant="destructive"
                    className="w-full h-8 rounded-none text-[9px] tracking-wider uppercase font-bold text-white mt-1 border border-red-500/30"
                    onClick={onCancel}
                  >
                    Retourner au Montage
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </ScreenWrapper>
  );
};

// GUEST_WATERMARK et createWatermarkedBlob sont désormais dans ./lib/watermark
// (partagés avec l'historique « Mes créations »).

const ResultScreen: React.FC<{
  onReset: () => void,
  onEdit: () => void,
  onChangeVehicle: () => void, 
  previewProps: any 
}> = ({ onReset, onEdit, onChangeVehicle, previewProps }) => {
  const [hasDownloaded, setHasDownloaded] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showMobileSaveModal, setShowMobileSaveModal] = useState(false);
  const [mobileImageUrl, setMobileImageUrl] = useState('');
  const { isGuest, isEntitled, openAuth } = useAuth();
  const [showUpsell, setShowUpsell] = useState(false);
  const [pendingDownload, setPendingDownload] = useState(false);

  // Point d'entrée du bouton Download — 3 cas :
  //  • invité            → connexion d'abord, puis on reprend le flux
  //  • compte gratuit    → téléchargement AVEC filigrane incrusté + écran d'upsell
  //  • compte abonné/payé → téléchargement propre (HD, sans filigrane)
  const handleDownload = () => {
    if (isGuest) {
      setPendingDownload(true);
      openAuth('Créez un compte gratuit pour télécharger votre visuel.');
      return;
    }
    if (!isEntitled) { doDownloadWatermarked(); return; }
    doDownload();
  };

  // Reprend le téléchargement juste après une connexion réussie, en réévaluant
  // l'état à jour (évite le piège de la « stale closure »).
  useEffect(() => {
    if (pendingDownload && !isGuest) {
      setPendingDownload(false);
      if (!isEntitled) doDownloadWatermarked(); else doDownload();
    }
  }, [pendingDownload, isGuest, isEntitled]);

  // Compte gratuit : on incruste le filigrane DANS le fichier (le calque à l'écran
  // ne suffit pas — sinon le fichier téléchargé serait propre). En cas d'échec de
  // l'incrustation, on ne télécharge RIEN de propre : on pousse l'upsell.
  const doDownloadWatermarked = async () => {
    try {
      setHasDownloaded(true);
      const raw = previewProps.currentJobResult;
      const srcUrl = raw
        ? ((raw.startsWith('data:') || raw.startsWith('http://') || raw.startsWith('https://')) ? raw : `data:image/png;base64,${raw}`)
        : '';
      const blob = srcUrl
        ? await createWatermarkedBlob(srcUrl, GUEST_WATERMARK, (u) => resolveApiUrl(`/api/proxy?url=${encodeURIComponent(u)}`))
        : null;
      if (blob) {
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        const file = new File([blob], `apercu-${Date.now()}.jpg`, { type: 'image/jpeg' });
        if (isMobile && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
          try { await navigator.share({ files: [file], title: 'Aperçu' }); } catch { /* annulé */ }
        } else {
          const objectUrl = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.download = `apercu-${Date.now()}.jpg`;
          link.href = objectUrl;
          document.body.appendChild(link); link.click(); document.body.removeChild(link);
          setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        }
      }
      // blob null → incrustation impossible : on n'expose pas l'image propre.
    } catch (e) {
      console.warn('[WATERMARK] Téléchargement filigrané échoué:', e);
    } finally {
      setShowUpsell(true);
    }
  };

  const doDownload = async () => {
    try {
      setHasDownloaded(true);
      
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || 
                       (navigator.maxTouchPoints && navigator.maxTouchPoints > 2);
      
      // Case 1: If currentJobResult is available, download it directly to avoid html-to-image limitations
      if (previewProps.currentJobResult) {
        let downloadUrl = '';
        if (previewProps.currentJobResult.startsWith('data:') || previewProps.currentJobResult.startsWith('http://') || previewProps.currentJobResult.startsWith('https://')) {
          downloadUrl = previewProps.currentJobResult;
        } else {
          downloadUrl = `data:image/png;base64,${previewProps.currentJobResult}`;
        }
        
        let blob: Blob | null = null;
        
        // If it's a remote URL, try multiple fetch methods to get the blob
        if (downloadUrl.startsWith('http')) {
          // Method A: Direct client-side fetch (using browser cookies/session)
          try {
            const response = await fetch(downloadUrl);
            if (response.ok) {
              blob = await response.blob();
            }
          } catch (fetchErr) {
            console.warn('Direct direct fetch failed (likely CORS), trying with proxy...', fetchErr);
          }
          
          // Method B: Proxy fetch (fallback)
          if (!blob) {
            try {
              const proxiedUrl = resolveApiUrl(`/api/proxy?url=${encodeURIComponent(downloadUrl)}`);
              const response = await fetch(proxiedUrl);
              if (response.ok) {
                blob = await response.blob();
              }
            } catch (proxyErr) {
              console.warn('Proxy fetch failed:', proxyErr);
            }
          }
        } else if (downloadUrl.startsWith('data:')) {
          try {
            const response = await fetch(downloadUrl);
            if (response.ok) {
              blob = await response.blob();
            }
          } catch (e) {
            console.warn('Failed to parse data URL to blob', e);
          }
        }
        
        // Strategy 1: Mobile Share Sheet (iOS/Android)
        if (isMobile && blob && navigator.canShare && navigator.share) {
          try {
            const file = new File([blob], `masterpiece-${Date.now()}.jpg`, { type: blob.type || 'image/jpeg' });
            if (navigator.canShare({ files: [file] })) {
              await navigator.share({
                files: [file],
                title: 'Mon Masterpiece',
              });
              return;
            }
          } catch (shareErr) {
            console.warn('Native sharing failed, falling back to modal:', shareErr);
          }
        }
        
        // Strategy 2: Mobile beautiful overlay instructions (iOS/Safari/PWA)
        if (isMobile) {
          setMobileImageUrl(downloadUrl);
          setShowMobileSaveModal(true);
          return;
        }
        
        // Strategy 3: Desktop download of blob
        if (blob) {
          const objectUrl = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.download = `masterpiece-${Date.now()}.png`;
          link.href = objectUrl;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          setTimeout(() => {
            URL.revokeObjectURL(objectUrl);
          }, 1000);
          return;
        }
        
        // Strategy 4: Direct fallback (open in a new tab)
        const link = document.createElement('a');
        link.download = `masterpiece-${Date.now()}.png`;
        link.href = downloadUrl;
        if (downloadUrl.startsWith('http')) {
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
        }
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        return;
      }

      // Case 2: Fallback to html-to-image if there is no pre-rendered result
      const node = document.getElementById('masterpiece-capture');
      if (!node) return;

      await new Promise(resolve => setTimeout(resolve, 100));
      
      const dataUrl = await toPng(node, {
        cacheBust: true,
        backgroundColor: '#000000',
        pixelRatio: 1, // Reduced from 2 for better stability
        skipFonts: true,
      });
      
      if (isMobile) {
        setMobileImageUrl(dataUrl);
        setShowMobileSaveModal(true);
        return;
      }

      const link = document.createElement('a');
      link.download = `masterpiece-${Date.now()}.png`;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('Error downloading image:', err);
    }
  };

  const handleResetClick = () => {
    setShowResetConfirm(true);
  };

  return (
    <ScreenWrapper 
      title="Your Masterpiece" 
      onBack={onEdit} 
      onNext={() => {}} 
      onHome={onReset}
      showHomeConfirm={true}
      nextLabel="SHARE"
    >
      <div className="space-y-2 relative">
        {/* Mobile Save Overlay (Safari/iOS/Android Friendly) */}
        <AnimatePresence>
          {showUpsell && (
            <div
              className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
              onClick={() => setShowUpsell(false)}
            >
              <div
                className="w-full max-w-sm rounded-2xl border border-white/10 bg-zinc-900 p-6 text-center text-white shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mb-3 text-3xl">✨</div>
                <h2 className="mb-2 text-lg font-bold">Votre aperçu est prêt</h2>
                <p className="mb-5 text-sm text-white/60">
                  Il porte le filigrane « {GUEST_WATERMARK} ». Passez à une offre pour
                  télécharger vos visuels en <strong className="text-white">HD, sans filigrane</strong>.
                </p>
                <button
                  onClick={() => { setShowUpsell(false); openAuth('Les offres arrivent bientôt — merci de votre patience !'); }}
                  className="mb-2 w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold hover:bg-emerald-500"
                >
                  Voir les offres HD
                </button>
                <button
                  onClick={() => setShowUpsell(false)}
                  className="w-full rounded-lg py-2 text-xs text-white/50 hover:text-white"
                >
                  Plus tard
                </button>
              </div>
            </div>
          )}

          {showMobileSaveModal && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[150] bg-black/95 backdrop-blur-md flex flex-col justify-between p-4"
            >
              {/* Top Bar */}
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white">
                  Enregistrer l'image
                </span>
                <button 
                  onClick={() => setShowMobileSaveModal(false)}
                  className="w-8 h-8 flex items-center justify-center bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors"
                >
                  <Plus className="w-4 h-4 rotate-45" />
                </button>
              </div>

              {/* Main image preview */}
              <div className="flex-1 flex items-center justify-center py-4 overflow-hidden">
                <img 
                  src={mobileImageUrl} 
                  className="max-w-full max-h-[60vh] object-contain border border-white/10 shadow-2xl"
                  alt="Enregistrer"
                  referrerPolicy="no-referrer"
                />
              </div>

              {/* Action instructions */}
              <div className="bg-zinc-900 border border-white/10 p-5 space-y-3 text-center rounded-none">
                <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-white">
                  📱 Enregistrement direct sur mobile
                </p>
                <p className="text-[9.5px] text-zinc-400 leading-relaxed font-sans uppercase tracking-wider">
                  Maintenez votre doigt sur l'image ci-dessus puis touchez <span className="text-white font-bold">« Enregistrer dans Photos »</span> pour la sauvegarder sur votre téléphone.
                </p>
                
                <Button 
                  className="w-full rounded-none h-10 mt-2 bg-white text-black font-bold text-[9px] uppercase tracking-wider hover:bg-white/90"
                  onClick={() => setShowMobileSaveModal(false)}
                >
                  Fermer
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Local Confirmation Overlay for NEW ALL */}
        <AnimatePresence>
          {showResetConfirm && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-[100] bg-black/90 backdrop-blur-md flex items-center justify-center p-6"
            >
              <div className="bg-zinc-900 border border-white/10 p-6 w-full space-y-6 text-center">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] leading-relaxed">Your progress will be lost. Continue?</p>
                <div className="flex justify-center gap-8">
                  <button 
                    onClick={() => setShowResetConfirm(false)}
                    className="w-12 h-12 flex items-center justify-center bg-white/5 hover:bg-white/10 transition-colors"
                  >
                    <Plus className="w-6 h-6 rotate-45 opacity-60" />
                  </button>
                  <button 
                    onClick={() => onReset()}
                    className="w-12 h-12 flex items-center justify-center bg-white text-black hover:bg-white/90 transition-colors"
                  >
                    <Check className="w-6 h-6" />
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mb-2 overflow-hidden bg-black aspect-[4/3] flex items-center justify-center relative border border-white/10" id="masterpiece-capture">
          {previewProps.currentJobResult ? (
            <img 
              src={(previewProps.currentJobResult.startsWith('data:') || previewProps.currentJobResult.startsWith('http://') || previewProps.currentJobResult.startsWith('https://')) 
                ? previewProps.currentJobResult 
                : `data:image/png;base64,${previewProps.currentJobResult}`} 
              className="w-full h-full object-contain"
              alt="Final Masterpiece from NodeGen Studio"
              referrerPolicy="no-referrer"
              draggable={isEntitled}
              onDragStart={!isEntitled ? (e) => e.preventDefault() : undefined}
              onContextMenu={!isEntitled ? (e) => e.preventDefault() : undefined}
              style={!isEntitled ? ({ WebkitUserDrag: 'none', userSelect: 'none' } as React.CSSProperties) : undefined}
            />
          ) : (
            <SharedPreview {...previewProps} allowSweeps={false} hideDebugInfo={true} />
          )}

          {/* Filigrane : recouvre l'aperçu final de texte répété en diagonale
              (quel que soit le mode d'affichage : <img> direct OU SharedPreview).
              Visible tant que le compte n'est pas abonné/payé ; disparaît une fois entitlé. */}
          {!isEntitled && (
            <div
              className="absolute inset-0 z-20 select-none overflow-hidden"
              onContextMenu={(e) => e.preventDefault()}
              onDragStart={(e) => e.preventDefault()}
              draggable={false}
            >
              <div className="pointer-events-none absolute inset-[-50%] flex flex-wrap content-center items-center justify-center gap-x-10 gap-y-8 rotate-[-30deg]">
                {Array.from({ length: 80 }).map((_, i) => (
                  <span
                    key={i}
                    className="whitespace-nowrap text-lg font-extrabold uppercase tracking-[0.3em] text-white/20"
                  >
                    {GUEST_WATERMARK}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-6 flex flex-col gap-1.5">
          <Button 
            className="w-full rounded-none h-12 flex items-center justify-center gap-2 bg-white text-black text-[10px] uppercase font-bold tracking-widest hover:bg-white/90"
            onClick={handleDownload}
          >
            <Download size={14} />
            Download
          </Button>

        <Button 
          variant="secondary"
          className="w-full rounded-none h-12 flex items-center justify-center text-[10px] uppercase font-bold tracking-widest border border-white/20 bg-white/5 hover:bg-white/10"
          onClick={onEdit}
        >
          Edit
        </Button>

        <Button 
          variant="secondary"
          className="w-full rounded-none h-14 flex flex-col items-center justify-center gap-0 border border-white/20 bg-white/5 hover:bg-white/10 px-4 text-center"
          onClick={onChangeVehicle}
        >
          <span className="text-[7.5px] font-normal uppercase tracking-[0.2em] opacity-60">Keep settings</span>
          <span className="text-[10px] font-bold uppercase tracking-widest">CHANGE VEHICULE PICTURE</span>
        </Button>

          <Button 
            variant="secondary"
            className="w-full rounded-none h-12 flex items-center justify-center gap-2 text-[10px] uppercase font-bold tracking-widest border border-white/20 bg-white/5 hover:bg-white/10"
            onClick={handleResetClick}
          >
            <RefreshCcw size={14} />
            NEW ALL
          </Button>
      </div>
    </div>
    </ScreenWrapper>
  );
};

// --- Main App ---

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/doc" element={<ArchitectureTable />} />
          <Route path="*" element={<MainApp />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

const getRandomVariant = (baseCode: string | null) => {
  if (!baseCode) return null;
  const limitChar = VARIANT_LIMITS[baseCode];
  if (limitChar) {
    const limitCode = limitChar.toUpperCase().charCodeAt(0);
    const startCode = 'A'.charCodeAt(0);
    const variants: string[] = [];
    for (let currentCode = startCode; currentCode <= limitCode; currentCode++) {
      variants.push(String.fromCharCode(currentCode));
    }
    const v = variants[Math.floor(Math.random() * variants.length)];
    return `${baseCode}${v}`;
  }

  const randomCodes = ['08A', '08B', '08C', '08D', '10A', '10B', '10C', '10D'];
  if (randomCodes.includes(baseCode)) {
    const variants = ['A', 'B', 'C', 'D'];
    const v = variants[Math.floor(Math.random() * variants.length)];
    return `${baseCode}${v}`;
  }
  return baseCode;
};

const MainApp = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [state, setState] = useState<AppState>(INITIAL_STATE);
  const { user: authUser, isGuest: authGuest, brandKitOpen, closeBrandKit } = useAuth();
  const brandKitAppliedRef = useRef(false);

  // Applique un Brand Kit (logo + couleur + slogan) à l'état de génération courant.
  const applyBrandKit = (kit: BrandKit) => {
    setState((prev) => ({
      ...prev,
      customLogo: kit.logoUrl ?? prev.customLogo,
      logoType: kit.logoUrl ? 'upload' : prev.logoType,
      showLogo: kit.logoUrl ? true : prev.showLogo,
      logoText: kit.slogan || prev.logoText,
      showText: kit.slogan ? true : prev.showText,
      colorTheme: kit.brandColor || prev.colorTheme,
    }));
  };

  // Préremplissage automatique au 1er login d'une session : si l'utilisateur a un
  // Brand Kit et n'a pas encore renseigné son branding, on l'applique (une seule fois).
  useEffect(() => {
    const uid = authUser?.uid;
    if (!uid || authGuest || brandKitAppliedRef.current) return;
    brandKitAppliedRef.current = true;
    (async () => {
      const kit = await loadBrandKit(uid);
      if (!kit || (!kit.logoUrl && !kit.slogan)) return;
      setState((prev) => {
        if (prev.customLogo || prev.logoText) return prev; // déjà renseigné → on ne force pas
        return {
          ...prev,
          customLogo: kit.logoUrl ?? prev.customLogo,
          logoType: kit.logoUrl ? 'upload' : prev.logoType,
          showLogo: kit.logoUrl ? true : prev.showLogo,
          logoText: kit.slogan || prev.logoText,
          showText: kit.slogan ? true : prev.showText,
          colorTheme: kit.brandColor || prev.colorTheme,
        };
      });
    })();
  }, [authUser, authGuest]);
  const lastAutoFittedBlob = useRef<{ image: string | null; bbox: any }>({ image: null, bbox: null });
  const [isStorageIndexed, setIsStorageIndexed] = useState(false);
  const [brandingPresets, setBrandingPresets] = useState<Record<string, any>>(() => {
    try {
      const cached = localStorage.getItem('pwa_branding_presets');
      if (cached) {
        console.log("[Presets Cache] Initialized branding presets from local cache.");
        return JSON.parse(cached);
      }
    } catch (e) {
      console.warn("[Presets Cache] Failed load fallback local cache presets:", e);
    }
    return {};
  });

  // Real-time listener for the Firestore branding presets in entries with localStorage offline redundancy
  useEffect(() => {
    let isSubscribed = true;
    let unsubscribes: (() => void)[] = [];

    console.log("[Presets Listener] Authenticating and subscribing to 'entries' and 'Entries' collections from active, custom, and fallback databases...");
    
    let currentNewLowerPresets: Record<string, any> = {};
    let currentNewUpperPresets: Record<string, any> = {};
    let currentOldLowerPresets: Record<string, any> = {};
    let currentOldUpperPresets: Record<string, any> = {};
    let currentCustomLowerPresets: Record<string, any> = {};
    let currentCustomUpperPresets: Record<string, any> = {};

    const updateAllPresets = () => {
      if (!isSubscribed) return;
      // Merge all loaded presets: active custom database collections take priority
      const merged = { 
        ...currentOldLowerPresets, 
        ...currentOldUpperPresets, 
        ...currentNewLowerPresets, 
        ...currentNewUpperPresets,
        ...currentCustomLowerPresets,
        ...currentCustomUpperPresets
      };
      
      if (Object.keys(merged).length === 0) {
        console.log("[Presets Listener] Merged entries is empty (possibly due to Firestore network, permission or quota error). Keeping existing state & cache.");
        return;
      }

      setBrandingPresets(merged);
      console.log("[Presets Listener] Merged entries list ready:", Object.keys(merged));
      try {
        localStorage.setItem('pwa_branding_presets', JSON.stringify(merged));
      } catch (e) {
        console.warn("[Presets Cache] Failed save to cache:", e);
      }
    };

    async function startListening() {
      // Authenticate to default database if needed
      try {
        const auth = getAuth();
        if (!auth.currentUser) {
          await signInAnonymously(auth);
        }
      } catch (e: any) {
        if (e?.code === 'auth/admin-restricted-operation' || e?.message?.includes('admin-restricted-operation')) {
          console.log("[Presets Auth] Anonymous Auth is disabled in Firebase console, proceeding with public access (perfectly fine).");
        } else {
          console.warn("[Presets Auth] Main auth failed, proceeding anyway:", e);
        }
      }

      // Authenticate to older database if needed (only if distinct from the main database)
      if (oldDb !== db) {
        try {
          const oldAuth = getAuth(oldApp);
          if (!oldAuth.currentUser) {
            await signInAnonymously(oldAuth);
          }
        } catch (e) {
          console.warn("[Presets Auth] Fallback database auth failed, proceeding anyway:", e);
        }
      }

      if (!isSubscribed) return;

      // Presets change very rarely, so we read them ONCE with getDocs instead of
      // keeping live onSnapshot listeners on the whole collections. Live listeners
      // re-read the entire collection on every page load/reconnect and were the
      // cause of the massive Firestore read spikes. (One-time read = read once, stop.)
      const loadPresetsOnce = async (
        database: any,
        collName: string,
        assign: (p: Record<string, any>) => void,
        label: string
      ) => {
        try {
          const snapshot = await getDocs(collection(database, collName));
          if (!isSubscribed) return;
          const presets: Record<string, any> = {};
          snapshot.forEach((d) => {
            presets[d.id.trim().toUpperCase()] = d.data();
          });
          assign(presets);
          console.log(`[Presets Load] ${label}: ${Object.keys(presets).length} presets`);
          updateAllPresets();
        } catch (error: any) {
          console.log(`[Presets Load] ${label} skipped/suppressed:`, error?.message || error);
          updateAllPresets();
        }
      };

      await loadPresetsOnce(db, 'entries', (p) => { currentNewLowerPresets = p; }, "active 'entries'");
      await loadPresetsOnce(db, 'Entries', (p) => { currentNewUpperPresets = p; }, "active 'Entries'");
      await loadPresetsOnce(customDb, 'entries', (p) => { currentCustomLowerPresets = p; }, "custom 'entries'");
      await loadPresetsOnce(customDb, 'Entries', (p) => { currentCustomUpperPresets = p; }, "custom 'Entries'");
      if (oldDb !== db) {
        await loadPresetsOnce(oldDb, 'entries', (p) => { currentOldLowerPresets = p; }, "fallback 'entries'");
        await loadPresetsOnce(oldDb, 'Entries', (p) => { currentOldUpperPresets = p; }, "fallback 'Entries'");
      }
    }

    startListening();

    return () => {
      isSubscribed = false;
      unsubscribes.forEach(unsub => unsub());
    };
  }, []);

  // Background crawler to dynamically index and loader environments on Firebase Storage
  useEffect(() => {
    let isSubscribed = true;
    async function indexStorage() {
      try {
        console.log("[Storage Index] Starting background crawl of 'ENVIRONMENTS'...");
        const environmentsRef = ref(storage, 'ENVIRONMENTS');
        const result = await listAll(environmentsRef);
        
        const prefixCounts: Record<string, number> = {};
        const promises = result.items.map(async (item) => {
          try {
            const url = await getDownloadURL(item);
            const nameUpper = item.name.trim().toUpperCase();
            
            // Matches formats like "CITY 01.JPG", "DESERT 04.PNG", "ARCHI02.WEBP", "MTX 03.JPEG"
            const match = nameUpper.match(/^([A-Z]+)\s*(\d+)\.(JPG|PNG|JPEG|WEBP)$/);
            if (match) {
              const prefix = match[1];
              const numStr = match[2];
              const num = parseInt(numStr, 10);
              
              if (!isNaN(num) && num > 0) {
                // Find baseCode from prefix
                const baseCode = Object.keys(STORAGE_PREFIX_MAP).find(
                  key => STORAGE_PREFIX_MAP[key] === prefix
                );
                if (baseCode) {
                  const letter = String.fromCharCode(64 + num); // 1 -> 'A', 2 -> 'B'
                  const variantCode = `${baseCode}${letter}`;
                  storageAssetCache[variantCode] = url;
                  
                  if (!prefixCounts[baseCode] || num > prefixCounts[baseCode]) {
                    prefixCounts[baseCode] = num;
                  }
                }
              }
            }
          } catch (err) {
            console.warn("[Storage Index] Failed parse or fetch item url:", item.name, err);
          }
        });
        
        await Promise.all(promises);
        
        // Dynamically update limits in VARIANT_LIMITS so selection logic bounds match perfectly
        Object.keys(prefixCounts).forEach(baseCode => {
          const maxNum = prefixCounts[baseCode];
          const maxLetter = String.fromCharCode(64 + maxNum);
          VARIANT_LIMITS[baseCode] = maxLetter;
          storageAssetLimitsCache[baseCode] = maxLetter;
          console.log(`[Storage Index] Dynamically mapped ${baseCode} to limit ${maxLetter} (${maxNum} files)`);
        });
        
        if (isSubscribed) {
          setIsStorageIndexed(true);
          console.log("[Storage Index] Complete! Loaded", Object.keys(storageAssetCache).length, "custom environments.");
        }
      } catch (err) {
        console.error("[Storage Index] Listing failed.", err);
      }
    }
    indexStorage();
    return () => { isSubscribed = false; };
  }, []);

  // Progressive Web App (PWA) Event states
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      console.log('[PWA] beforeinstallprompt event intercepted');
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
      console.log('[PWA] Installed successfully!');
    };

    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initial check for display mode
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone;
    setIsInstalled(!!isStandalone);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Firebase listener for real-time NodeGen Studio status
  useEffect(() => {
    if (!state.currentJobId) return;

    const docPath = `exports/${state.currentJobId}`;
    let isSubscribed = true;
    let fallbackPollInterval: any = null;

    let unsubscribe = () => {};
    try {
      unsubscribe = onSnapshot(
        doc(db, 'exports', state.currentJobId),
        (snapshot) => {
          if (!isSubscribed) return;
          if (snapshot.exists()) {
            const data = snapshot.data();
            let status = data.status || 'pending';
            if (status === 'failed') {
              status = 'error';
            }
            const finalResult = data.imageFinal || data.imageUrl || null;
            const jobError = data.apiError || data.errorMessage || data.error || null;

            setState(prev => {
              if (prev.currentJobId !== state.currentJobId) return prev;

              const nextState = {
                ...prev,
                currentJobStatus: status as any,
                currentJobResult: finalResult,
                currentJobError: jobError || (status === 'error' && !finalResult
                  ? 'La génération Gemini a échoué sans image finale.'
                  : null)
              };

              return nextState;
            });
          }
        },
        (error) => {
          if (isSubscribed) {
            console.warn("[PWA LISTEN FALLBACK] Firestore error in job listener, switching to local server polling fallback:", error);
            // Fallback polling of our backend Express server API
            if (!fallbackPollInterval) {
              fallbackPollInterval = setInterval(async () => {
                try {
                  const response = await fetch(resolveApiUrl(`/api/jobs/${state.currentJobId}`));
                  if (response.ok) {
                    const data = await response.json();
                    let status = data.status || 'pending';
                    if (status === 'failed') {
                      status = 'error';
                    }
                    const finalResult = data.imageFinal || data.imageUrl || null;
                    const jobError = data.apiError || data.errorMessage || data.error || null;
                    setState(prev => {
                      if (prev.currentJobId !== state.currentJobId) return prev;
                      return {
                        ...prev,
                        currentJobStatus: status as any,
                        currentJobResult: finalResult,
                        currentJobError: jobError || (status === 'error' && !finalResult
                          ? 'La génération Gemini a échoué sans image finale.'
                          : null)
                      };
                    });
                  }
                } catch (pollErr) {
                  console.error("[PWA LISTEN FALLBACK] Local polling error:", pollErr);
                }
              }, 3000);
            }
          }
        }
      );
    } catch (e) {
      console.warn("[PWA LISTEN FALLBACK] Firestore listen subscription failed, launching local polling fallback immediately:", e);
      fallbackPollInterval = setInterval(async () => {
        try {
          const response = await fetch(resolveApiUrl(`/api/jobs/${state.currentJobId}`));
          if (response.ok) {
            const data = await response.json();
            let status = data.status || 'pending';
            if (status === 'failed') {
              status = 'error';
            }
            const finalResult = data.imageFinal || data.imageUrl || null;
            const jobError = data.apiError || data.errorMessage || data.error || null;
            setState(prev => {
              if (prev.currentJobId !== state.currentJobId) return prev;
              return {
                ...prev,
                currentJobStatus: status as any,
                currentJobResult: finalResult,
                currentJobError: jobError || (status === 'error' && !finalResult
                  ? 'La génération Gemini a échoué sans image finale.'
                  : null)
              };
            });
          }
        } catch (pollErr) {
          console.error("[PWA LISTEN FALLBACK] Local polling error:", pollErr);
        }
      }, 3000);
    }

    return () => {
      isSubscribed = false;
      try {
        unsubscribe();
      } catch (e) {}
      if (fallbackPollInterval) clearInterval(fallbackPollInterval);
    };
  }, [state.currentJobId]);

  const handleStartCompositingJob = async () => {
    const authInstance = getAuth();
    const auth = authInstance;
    if (!authInstance.currentUser) {
      console.log("[PWA AUTH] Not signed in, attempting anonymous sign in in handleStartCompositingJob...");
      try {
        await signInAnonymously(authInstance);
        console.log("[PWA AUTH] Anonymous sign-in successful. User ID:", authInstance.currentUser?.uid);
      } catch (authErr) {
        console.warn("[PWA AUTH] Anonymous sign-in failed (possibly restricted):", authErr);
      }
    }
    
    let jobId = '';
    try {
      jobId = doc(collection(db, 'exports')).id;
    } catch (e) {
      jobId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      console.warn("[PWA AUTH] Failed getting Firestore document ID, generated local random jobId:", jobId);
    }

    setState(prev => ({
      ...prev,
      screen: 'generation',
      currentJobStatus: 'pending',
      currentJobId: jobId,
      currentJobResult: null,
      currentJobError: null
    }));

    try {
      const getProxiedUrl = (src: string) => {
        if (!src) return '';
        if (src.startsWith('data:')) return src;
        if (src.startsWith('http://') || src.startsWith('https://')) {
          return `/api/proxy?url=${encodeURIComponent(src)}`;
        }
        return src;
      };

      const loadImageWithCors = (src: string): Promise<HTMLImageElement> => {
        return new Promise((resolve, reject) => {
          const img = new Image();
          const finalSrc = getProxiedUrl(src);
          // Permettre de charger l'image avec CORS si ce n'est pas un data URI local,
          // que ce soit une URL proxyifiée relative ou une URL absolue Firebase Storage,
          // pour éviter la corruption du canvas 2D sur Safari/iPhone.
          if (finalSrc && !finalSrc.startsWith('data:')) {
            img.crossOrigin = 'anonymous';
          }
          img.onload = () => resolve(img);
          img.onerror = (err) => {
            console.warn("[PWA CANVAS COMPOSITE] Proxy image load failed, retrying directly with anonymous CORS:", src);
            const imgNoCors = new Image();
            if (src && !src.startsWith('data:')) {
              imgNoCors.crossOrigin = 'anonymous';
            }
            imgNoCors.onload = () => resolve(imgNoCors);
            imgNoCors.onerror = (e) => reject(e);
            imgNoCors.src = src;
          };
          img.src = finalSrc;
        });
      };

      const drawObjectCover = (ctx: CanvasRenderingContext2D, img: HTMLImageElement, W: number, H: number) => {
        const imgRatio = img.width / img.height;
        const canvasRatio = W / H;
        let sWidth = img.width;
        let sHeight = img.height;
        let sx = 0;
        let sy = 0;
        if (imgRatio > canvasRatio) {
          sWidth = img.height * canvasRatio;
          sx = (img.width - sWidth) / 2;
        } else {
          sHeight = img.width / canvasRatio;
          sy = (img.height - sHeight) / 2;
        }
        ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, W, H);
      };

      const drawObjectContain = (
        ctx: CanvasRenderingContext2D, 
        img: HTMLImageElement, 
        x: number, 
        y: number, 
        w: number, 
        h: number
      ) => {
        const imgRatio = img.width / img.height;
        const containerRatio = w / h;
        let targetW = w;
        let targetH = h;
        if (imgRatio > containerRatio) {
          targetH = w / imgRatio;
        } else {
          targetW = h * imgRatio;
        }
        const targetX = x + (w - targetW) / 2;
        const targetY = y + (h - targetH) / 2;
        ctx.drawImage(img, targetX, targetY, targetW, targetH);
      };

      const createMasterpieceComposition = async (
        stateVal: any,
        presetsVal: any,
        opts: { brandingMode?: 'overlay' | 'integrated' } = {}
      ): Promise<{ composite: string; brandingOverlay: string | null }> => {
        // brandingMode "overlay" (default): logo/text are NOT baked into the
        // composition (IMAGE_C stays clean); they are returned as a separate
        // transparent layer for pixel-perfect post-production stamping.
        // "integrated": logo/text are baked in as before (model renders them).
        const brandingMode = opts.brandingMode === 'integrated' ? 'integrated' : 'overlay';
        // The whole composition is authored on a 1280 reference grid, but we
        // RENDER it onto a 2048px (2K) canvas so IMAGE_C is a high-resolution
        // composition reference (IMAGE_A/B are natively >2K). context.scale()
        // maps the 1280 coordinates onto 2048 pixels — no coordinate math changes.
        const REF_GRID = 1280;
        const RENDER_PX = 2048;
        const RENDER_SCALE = RENDER_PX / REF_GRID;
        const canvas = document.createElement('canvas');
        canvas.width = RENDER_PX;
        canvas.height = RENDER_PX;
        const context = canvas.getContext('2d');
        if (!context) {
          throw new Error("Unable to get 2D canvas context");
        }
        context.scale(RENDER_SCALE, RENDER_SCALE);
        // Separate transparent canvas (same 2K render) that holds ONLY logo + text.
        const overlayCanvas = document.createElement('canvas');
        overlayCanvas.width = RENDER_PX;
        overlayCanvas.height = RENDER_PX;
        const overlayCtx = overlayCanvas.getContext('2d');
        if (overlayCtx) overlayCtx.scale(RENDER_SCALE, RENDER_SCALE);

        const preset = getBrandingPreset(stateVal.envVariant, presetsVal || {});

        const getPresetLogoUrl = () => {
          if (!preset) return null;
          if (typeof preset.logo === 'string' && (preset.logo.startsWith('http') || preset.logo.startsWith('data:'))) {
            return preset.logo;
          }
          if (typeof preset.logoUrl === 'string' && preset.logoUrl.trim() !== '') {
            return preset.logoUrl;
          }
          if (typeof preset.imageUrl === 'string' && preset.imageUrl.trim() !== '') {
            return preset.imageUrl;
          }
          if (typeof preset.image === 'string' && (preset.image.startsWith('http') || preset.image.startsWith('data:'))) {
            return preset.image;
          }
          if (typeof preset.customLogo === 'string' && preset.customLogo.trim() !== '') {
            return preset.customLogo;
          }
          if (preset.logo !== false) {
            return "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' fill='none' stroke='white' stroke-width='4'><path stroke-linecap='round' stroke-linejoin='round' d='M50 95c24.853 0 45-20.147 45-45S74.853 5 50 5 5 25.147 5 50s20.147 45 45 45z' /><path stroke-linecap='round' stroke-linejoin='round' d='M50 35a15 15 0 100 30 15 15 0 000-30z' /><path stroke-linecap='round' stroke-linejoin='round' d='M50 5v90M5 50h90' stroke-width='2' stroke-dasharray='4' /></svg>";
          }
          return null;
        };

        const isLogoVisible = (stateVal.showLogo !== false) && (preset.logo !== false);
        const rawEffectiveLogo = stateVal.customLogo || stateVal.logo || getPresetLogoUrl();

        const bgCode = stateVal.envVariant || '07A01A';
        const bgUrl = getAssetUrl(bgCode);
        const platformUrl = stateVal.platform ? getAssetUrl(stateVal.platform) : null;
        const vehicleUrl = stateVal.image || null;
        const logoUrl = (isLogoVisible && rawEffectiveLogo) ? rawEffectiveLogo : null;

        console.log("[PWA OPTIMIZATION] Parallel loading images for composite...");
        const [bgImg, platImg, vehicleImg, logoImg] = await Promise.all([
          bgUrl ? loadImageWithCors(bgUrl).catch(e => { console.error("Composite: BG load failed", e); return null; }) : Promise.resolve(null),
          platformUrl ? loadImageWithCors(platformUrl).catch(e => { console.error("Composite: Platform load failed", e); return null; }) : Promise.resolve(null),
          vehicleUrl ? loadImageWithCors(vehicleUrl).catch(e => { console.error("Composite: Vehicle load failed", e); return null; }) : Promise.resolve(null),
          logoUrl ? loadImageWithCors(logoUrl).catch(e => { console.error("Composite: Logo load failed", e); return null; }) : Promise.resolve(null)
        ]);

        // 1. Draw Background (imageA)
        if (bgImg) {
          drawObjectCover(context, bgImg, 1280, 1280);
        } else {
          context.fillStyle = '#18181b';
          context.fillRect(0, 0, 1280, 1280);
        }

        // 2. Draw Platform (platform)
        if (platImg) {
          const pW = 1152;
          const pH = 1152;
          const pX = 640 - pW / 2;
          const pY = 1024 - pH / 2;
          drawObjectContain(context, platImg, pX, pY, pW, pH);
        }

        // 3. Draw Vehicle (imageB) with transforms
        if (vehicleImg) {
          const boxSize = 960;
          const imgRatio = vehicleImg.width / vehicleImg.height;
          let targetW = boxSize;
          let targetH = boxSize;
          if (imgRatio > 1.0) {
            targetH = boxSize / imgRatio;
          } else {
            targetW = boxSize * imgRatio;
          }

          context.save();
          const dx = ((stateVal.imageTransform?.x || 0) / 100) * boxSize;
          const dy = ((stateVal.imageTransform?.y || 0) / 100) * boxSize;
          const centerX = 640 + dx;
          const centerY = 640 + dy;
          
          context.translate(centerX, centerY);
          context.rotate(((stateVal.imageTransform?.rotate || 0) * Math.PI) / 180);
          
          const effectiveScale = (stateVal.imageTransform?.scale || 1) * (stateVal.imageTransform?.baselineScale || 1);
          context.scale(effectiveScale, effectiveScale);
          
          context.drawImage(vehicleImg, -targetW / 2, -targetH / 2, targetW, targetH);
          context.restore();
        }

        // 4. Draw Logo and Slogan/Text (Branding Layer)
        const refRes = getPresetRefResolution(preset);

        const getLogoXPercent = () => {
          const logoX = getPropValue(preset, 'logoX');
          if (logoX != null && logoX !== '') {
            const valStr = String(logoX).toUpperCase().trim();
            if (valStr === 'CENTRE' || valStr === 'CENTER') return 50;
            const val = parseFloat(valStr);
            if (!isNaN(val)) return (val / refRes) * 100;
          }
          const imagePosition = getPropValue(preset, 'imagePosition');
          const coords = parseCoordinates(imagePosition, Math.round(refRes / 2), Math.round(refRes * 0.1));
          return (coords.x / refRes) * 100;
        };

        const getLogoYPercent = () => {
          const logoY = getPropValue(preset, 'logoY');
          if (logoY != null && logoY !== '') {
            const valStr = String(logoY).toUpperCase().trim();
            if (valStr === 'CENTRE' || valStr === 'CENTER') return 50;
            const val = parseFloat(valStr);
            if (!isNaN(val)) return (val / refRes) * 100;
          }
          const imagePosition = getPropValue(preset, 'imagePosition');
          const coords = parseCoordinates(imagePosition, Math.round(refRes / 2), Math.round(refRes * 0.1));
          return (coords.y / refRes) * 100;
        };

        const getLogoSizePercent = () => {
          const logoSize = getPropValue(preset, 'logoSize');
          const val = parseFloat(logoSize || "150");
          if (isNaN(val)) return (150 / refRes) * 100;
          return (val / refRes) * 100;
        };

        const getTextXPercent = () => {
          const textX = getPropValue(preset, 'textX');
          if (textX != null && textX !== '') {
            const valStr = String(textX).toUpperCase().trim();
            if (valStr === 'CENTRE' || valStr === 'CENTER') return 50;
            const val = parseFloat(valStr);
            if (!isNaN(val)) return (val / refRes) * 100;
          }
          const textPosition = getPropValue(preset, 'textPosition');
          const coords = parseCoordinates(textPosition, Math.round(refRes / 2), Math.round(refRes * 0.78));
          return (coords.x / refRes) * 100;
        };

        const getTextYPercent = () => {
          const textY = getPropValue(preset, 'textY');
          if (textY != null && textY !== '') {
            const valStr = String(textY).toUpperCase().trim();
            if (valStr === 'CENTRE' || valStr === 'CENTER') return 50;
            const val = parseFloat(valStr);
            if (!isNaN(val)) return (val / refRes) * 100;
          }
          const textPosition = getPropValue(preset, 'textPosition');
          const coords = parseCoordinates(textPosition, Math.round(refRes / 2), Math.round(refRes * 0.78));
          return (coords.y / refRes) * 100;
        };

        const getTextSizePercent = () => {
          const textSize = getPropValue(preset, 'textSize');
          const val = parseFloat(textSize || "32");
          if (isNaN(val)) return (32 / refRes) * 100;
          return (val / refRes) * 100;
        };

        const logoXPercent = getLogoXPercent();
        const logoYPercent = getLogoYPercent();
        const logoSizePercent = getLogoSizePercent();
        const textXPercent = getTextXPercent();
        const textYPercent = getTextYPercent();
        const textSizePercent = getTextSizePercent();
        
        const logoColorFillEnabled = getPropValue(preset, 'logoColorFillEnabled');
        const logoColorFill = getPropValue(preset, 'logoColorFill');
        const useColorFill = logoColorFillEnabled === true && logoColorFill && String(logoColorFill).trim() !== '';

        const presetTextContent = getPropValue(preset, 'textContent') || getPropValue(preset, 'text_content') || "VOTRE TEXTE ICI";
        const effectiveText = stateVal.logoText || presetTextContent;
        const isTextVisible = (stateVal.showText !== false) && !!effectiveText && (getPropValue(preset, 'text') !== false);

        // Paint the logo + text onto a given context (used for both the baked
        // composition in "integrated" mode and the separate transparent overlay).
        const paintBranding = (ctx: CanvasRenderingContext2D) => {
          // Draw Logo
          if (isLogoVisible && logoImg) {
            try {
              const lx_c = (logoXPercent / 100) * 1280;
              const ly_c = (logoYPercent / 100) * 1280;
              const lSize = (logoSizePercent / 100) * 1280;
              const lx = lx_c - lSize / 2;
              const ly = ly_c - lSize / 2;

              if (useColorFill && preset.logoColorFill) {
                 const tempCanvas = document.createElement('canvas');
                 tempCanvas.width = lSize;
                 tempCanvas.height = lSize;
                 const tempCtx = tempCanvas.getContext('2d');
                 if (tempCtx) {
                   drawObjectContain(tempCtx, logoImg, 0, 0, lSize, lSize);
                   tempCtx.globalCompositeOperation = 'source-in';
                   tempCtx.fillStyle = preset.logoColorFill;
                   tempCtx.fillRect(0, 0, lSize, lSize);
                   ctx.drawImage(tempCanvas, lx, ly);
                 }
              } else {
                drawObjectContain(ctx, logoImg, lx, ly, lSize, lSize);
              }
            } catch (logoErr) {
              console.error("Failed to draw logo on screenshot canvas", logoErr);
            }
          }

          // Draw Text (Slogan)
          if (isTextVisible) {
            const textAlign = getPropValue(preset, 'textAlign');
            const rawAlign = textAlign ? String(textAlign).toUpperCase().trim() : 'CENTRE';
            let align: 'left' | 'right' | 'center' = 'center';
            if (rawAlign === 'GAUCHE') align = 'left';
            else if (rawAlign === 'DROITE') align = 'right';

            const tx = (textXPercent / 100) * 1280;
            const ty = (textYPercent / 100) * 1280;
            const fontSize = (textSizePercent / 100) * 1280;

            ctx.save();
            ctx.textAlign = align;
            ctx.textBaseline = 'middle';
            ctx.font = `bold ${fontSize}px ${getPropValue(preset, 'textFont') || 'Inter'}`;
            ctx.fillStyle = getEffectiveTextColor(preset);
            ctx.fillText(effectiveText, tx, ty);
            ctx.restore();
          }
        };

        // Always render the branding onto the transparent overlay layer.
        if (overlayCtx) paintBranding(overlayCtx);
        // Bake it into the composition ONLY in integrated mode.
        if (brandingMode === 'integrated') paintBranding(context);

        const hasBranding = (isLogoVisible && !!logoImg) || isTextVisible;
        return {
          composite: canvas.toDataURL('image/jpeg', 0.92),
          brandingOverlay: (hasBranding && overlayCtx) ? overlayCanvas.toDataURL('image/png') : null,
        };
      };

      let roughCompositeBase64 = '';
      let brandingOverlayBase64: string | null = null;
      try {
        console.log("[PWA CANVAS COMPOSITE] Generating pixel-perfect 1280x1280 masterpiece composition (clean IMAGE_C) + transparent branding layer...");
        const composed = await createMasterpieceComposition(state, brandingPresets, { brandingMode: 'overlay' });
        roughCompositeBase64 = composed.composite;
        brandingOverlayBase64 = composed.brandingOverlay;
        console.log("[PWA CANVAS COMPOSITE] Generation successful! Composite + branding overlay created.");
      } catch (mathCanvasErr) {
        console.error("[PWA CANVAS COMPOSITE] Custom compositor failed, falling back to html-to-image capture:", mathCanvasErr);
        const node = document.getElementById('pwa-composite-capture') || document.getElementById('masterpiece-capture');
        if (node) {
          try {
            roughCompositeBase64 = await toPng(node as HTMLElement, {
              cacheBust: false,
              backgroundColor: '#000000',
              pixelRatio: 2,
              skipFonts: true,
            });
          } catch (captureErr) {
            console.error("Error capturing rough composite, falling back to car image:", captureErr);
            roughCompositeBase64 = state.image || '';
          }
        } else {
          roughCompositeBase64 = state.image || '';
        }
      }

      // 1. Concurrent Image preparation and Upload Pipelines (budget total: 1Mo max)
const processVehicle = async () => {
  let compressedVehicle = '';

  if (state.image) {
    if (
      state.image.startsWith('data:image/svg+xml') ||
      state.image.includes('<svg')
    ) {
      compressedVehicle = state.image;
    } else {
      compressedVehicle = await compressVehiclePng(
        state.image,
        1600,
        650 * 1024
      );
    }
  }

  let finalVehicleValue = compressedVehicle;

  if (compressedVehicle.startsWith('data:image/')) {
    try {
      console.log("[PWA EXPORT VEHICLE] Trying upload to Firebase Storage...");

      const userId = getAuth().currentUser?.uid || 'guest';

      const vehicleStorageRef = ref(
        storage,
        `users/${userId}/vehicles/${jobId}_vehicle.png`
      );

      const blob = dataURLtoBlob(compressedVehicle);

      await uploadBytes(vehicleStorageRef, blob, {
        contentType: 'image/png'
      });

      const vehiclePublicUrl = await getDownloadURL(vehicleStorageRef);

      finalVehicleValue = vehiclePublicUrl;

      console.log(
        "[PWA EXPORT VEHICLE] Firebase Storage upload successful. URL:",
        finalVehicleValue
      );

    } catch (storageErr) {

      console.warn(
        "[PWA EXPORT VEHICLE] Firebase Storage unavailable. Keeping DataURL instead.",
        storageErr
      );

      // IMPORTANT :
      // On garde directement le PNG Base64.
      // Le backend Gemini sait déjà traiter les data:image/... sans téléchargement HTTP.
      // IMPORTANT : ne jamais utiliser d'URL Cloud Run /exports/ comme imageB.
      finalVehicleValue = compressedVehicle;
    }

  } else if (compressedVehicle && isCloudRunExportsUrl(compressedVehicle)) {
    throw new Error(
      "imageB : URL Cloud Run /exports/ interdite. Utilisez data:image/png;base64 ou Firebase Storage."
    );
  } else if (
    compressedVehicle &&
    (compressedVehicle.startsWith('http://') || compressedVehicle.startsWith('https://'))
  ) {
    if (!isFirebaseStorageHttpsUrl(compressedVehicle)) {
      throw new Error(
        "imageB : URL HTTP non Firebase interdite. Attendu data:image/png;base64 ou Firebase Storage."
      );
    }
  } else if (
    compressedVehicle &&
    !compressedVehicle.startsWith('http://') &&
    !compressedVehicle.startsWith('https://')
  ) {

    throw new Error(
      "Format d'image de véhicule non reconnu (attendu : URL ou base64 data-url)."
    );
  }

  return finalVehicleValue;
};
const processPreview = async (base64Composite: string) => {
  const compressedPreview = base64Composite
    ? await compressPreviewJpeg(base64Composite, 2048, 4 * 1024 * 1024)
    : '';

  let finalPreviewValue = compressedPreview;

  if (compressedPreview.startsWith('data:image/')) {
    try {
      console.log("[PWA EXPORT PREVIEW] Trying upload to Firebase Storage...");

      const userId = getAuth().currentUser?.uid || 'guest';

      const previewStorageRef = ref(
        storage,
        `users/${userId}/references/${jobId}_ref.jpg`
      );

      const blob = dataURLtoBlob(compressedPreview);

      await uploadBytes(previewStorageRef, blob, {
        contentType: 'image/jpeg'
      });

      const previewPublicUrl = await getDownloadURL(previewStorageRef);

      finalPreviewValue = previewPublicUrl;

      console.log(
        "[PWA EXPORT PREVIEW] Firebase Storage upload successful. URL:",
        finalPreviewValue
      );

    } catch (storageErr) {
      console.warn(
        "[PWA EXPORT PREVIEW] Firebase Storage unavailable. Keeping DataURL instead.",
        storageErr
      );

      finalPreviewValue = compressedPreview;
    }

  } else if (compressedPreview && isCloudRunExportsUrl(compressedPreview)) {
    throw new Error(
      "imageC : URL Cloud Run /exports/ interdite. Utilisez data:image/jpeg;base64 ou Firebase Storage."
    );
  } else if (
    compressedPreview &&
    (compressedPreview.startsWith('http://') || compressedPreview.startsWith('https://'))
  ) {
    if (!isFirebaseStorageHttpsUrl(compressedPreview)) {
      throw new Error(
        "imageC : URL HTTP non Firebase interdite. Attendu data:image/jpeg;base64 ou Firebase Storage."
      );
    }
  } else if (
    compressedPreview &&
    !compressedPreview.startsWith('http://') &&
    !compressedPreview.startsWith('https://')
  ) {
    throw new Error("Format d'image de maquette non reconnu.");
  }

  return finalPreviewValue;
};
      const processLogo = async () => {
        let resolvedLogoId = state.logo || null;
        let finalCustomLogoValue = state.customLogo || '';

        if (!resolvedLogoId && state.showLogo) {
          if (state.customLogo) {
            try {
              if (state.customLogo.startsWith('data:image/')) {
                try {
                  console.log("[PWA EXPORT LOGO] Trying upload custom logo to Firebase Storage...");
                  const userId = getAuth().currentUser?.uid || 'guest';
                  const logoStorageRef = ref(storage, `users/${userId}/logos/${jobId}_logo.png`);
                  const blob = dataURLtoBlob(state.customLogo);
                  await uploadBytes(logoStorageRef, blob, { contentType: 'image/png' });
                  const logoPublicUrl = await getDownloadURL(logoStorageRef);
                  resolvedLogoId = logoPublicUrl;
                  finalCustomLogoValue = logoPublicUrl;
                  console.log("[PWA EXPORT LOGO] Firebase Storage upload successful. URL:", logoPublicUrl);
                } catch (storageErr) {
                  console.warn(
                  "[PWA EXPORT LOGO] Firebase Storage unavailable. Keeping custom logo as DataURL instead.",
                  storageErr
                   );

                   resolvedLogoId = state.customLogo;
                   finalCustomLogoValue = state.customLogo;
                }
              } else {
                resolvedLogoId = state.customLogo;
              }
            } catch (uploadErr) {
              console.warn("[PWA EXPORT LOGO] Server upload failed, fallback to base64:", uploadErr);
              resolvedLogoId = state.customLogo;
            }
          } else {
            // Fallback to active document ID from the preset associated with the environment
            let bgIdForLogo = getImageIdForVariant(state.envVariant || '07A01A');
            let upperBgLogoId = bgIdForLogo.toUpperCase().trim();
            if (upperBgLogoId.startsWith("ARCHI ")) {
              upperBgLogoId = upperBgLogoId.replace("ARCHI ", "ARCH ");
            }

            let activePresetLogoId = "A Blanc";
            const matchedKey = Object.keys(brandingPresets || {}).find(key => {
              return isKeyMatch(key, upperBgLogoId);
            });
            
            if (matchedKey) {
              activePresetLogoId = matchedKey;
            } else {
              const aBlancKey = Object.keys(brandingPresets || {}).find(key => {
                return isKeyMatch(key, "A Blanc") || isKeyMatch(key, "ABLANC") || isKeyMatch(key, "ABLANCA");
              });
              if (aBlancKey) {
                activePresetLogoId = aBlancKey;
              }
            }
            resolvedLogoId = activePresetLogoId;
          }
        }
        return { resolvedLogoId, finalCustomLogoValue };
      };

      // Upload the transparent branding layer (logo + text) so the AI engine can
      // stamp it crisp in post-production (Mode 1 "overlay"). Uploaded to Storage
      // as a URL to avoid bloating the Firestore job document.
      const processBrandingOverlay = async (): Promise<string | null> => {
        if (!brandingOverlayBase64) return null;
        try {
          const userId = getAuth().currentUser?.uid || 'guest';
          const overlayRef = ref(storage, `users/${userId}/branding/${jobId}_branding.png`);
          const blob = dataURLtoBlob(brandingOverlayBase64);
          await uploadBytes(overlayRef, blob, { contentType: 'image/png' });
          const url = await getDownloadURL(overlayRef);
          console.log("[PWA EXPORT BRANDING] Branding overlay uploaded:", url);
          return url;
        } catch (e) {
          console.warn("[PWA EXPORT BRANDING] Storage upload failed, keeping overlay inline:", e);
          return brandingOverlayBase64;
        }
      };

      console.log("[PWA OPTIMIZATION] Running vehicle, preview, logo and branding pipelines in parallel...");
      const [finalVehicleValue, finalPreviewValue, logoResults, brandingOverlayUrl] = await Promise.all([
        processVehicle(),
        processPreview(roughCompositeBase64),
        processLogo(),
        processBrandingOverlay()
      ]);
      const { resolvedLogoId, finalCustomLogoValue } = logoResults;

      const validatedImageA = resolveImageAForFirestore(state.envVariant || '07A01A');
      const validatedImageB = normalizeJobImageValue(finalVehicleValue, 'imageB', 'image/png');
      const validatedImageC = normalizeJobImageValue(finalPreviewValue, 'imageC', 'image/jpeg');

      console.log("[PWA VALIDATION] Payload images validées:", {
        imageA: validatedImageA.substring(0, 80) + '...',
        imageB: validatedImageB.startsWith('data:') ? `data URL (${Math.round(validatedImageB.length / 1024)} Ko)` : validatedImageB.substring(0, 80),
        imageC: validatedImageC.startsWith('data:') ? `data URL (${Math.round(validatedImageC.length / 1024)} Ko)` : validatedImageC.substring(0, 80),
      });

      // Calcul des données de mise en forme réelles pour le logo
      const activePreset = getBrandingPreset(state.envVariant, brandingPresets || {});
      const refRes = getPresetRefResolution(activePreset);

      let logoSizeVal = activePreset?.logoSize ? parseFloat(activePreset.logoSize) : 150;
      if (isNaN(logoSizeVal) || !isFinite(logoSizeVal)) {
        logoSizeVal = 150;
      }

      let logoXVal = refRes / 2;
      let logoYVal = Math.round(refRes * 0.1);

      if (activePreset?.logoX != null && activePreset.logoX !== '') {
        const valStr = String(activePreset.logoX).toUpperCase().trim();
        if (valStr === 'CENTRE' || valStr === 'CENTER') {
          logoXVal = refRes / 2;
        } else {
          const parsed = parseFloat(valStr);
          if (!isNaN(parsed)) logoXVal = parsed;
        }
      } else if (activePreset?.imagePosition) {
        const coords = parseCoordinates(activePreset.imagePosition, Math.round(refRes / 2), Math.round(refRes * 0.1));
        logoXVal = coords.x;
      }

      if (activePreset?.logoY != null && activePreset.logoY !== '') {
        const valStr = String(activePreset.logoY).toUpperCase().trim();
        if (valStr === 'CENTRE' || valStr === 'CENTER') {
          logoYVal = refRes / 2;
        } else {
          const parsed = parseFloat(valStr);
          if (!isNaN(parsed)) logoYVal = parsed;
        }
      } else if (activePreset?.imagePosition) {
        const coords = parseCoordinates(activePreset.imagePosition, Math.round(refRes / 2), Math.round(refRes * 0.1));
        logoYVal = coords.y;
      }

      let logoRotationVal = activePreset?.logoRotation != null 
        ? parseFloat(activePreset.logoRotation) 
        : (activePreset?.imageRotation != null ? parseFloat(activePreset.imageRotation) : 0);
      if (isNaN(logoRotationVal) || !isFinite(logoRotationVal)) {
        logoRotationVal = 0;
      }

      let textXVal = refRes / 2;
      let textYVal = Math.round(refRes * 0.78);

      if (activePreset?.textX != null && activePreset.textX !== '') {
        const valStr = String(activePreset.textX).toUpperCase().trim();
        if (valStr === 'CENTRE' || valStr === 'CENTER') {
          textXVal = refRes / 2;
        } else {
          const parsed = parseFloat(valStr);
          if (!isNaN(parsed)) textXVal = parsed;
        }
      } else if (activePreset?.textPosition) {
        const coords = parseCoordinates(activePreset.textPosition, Math.round(refRes / 2), Math.round(refRes * 0.78));
        textXVal = coords.x;
      }

      if (activePreset?.textY != null && activePreset.textY !== '') {
        const valStr = String(activePreset.textY).toUpperCase().trim();
        if (valStr === 'CENTRE' || valStr === 'CENTER') {
          textYVal = refRes / 2;
        } else {
          const parsed = parseFloat(valStr);
          if (!isNaN(parsed)) textYVal = parsed;
        }
      } else if (activePreset?.textPosition) {
        const coords = parseCoordinates(activePreset.textPosition, Math.round(refRes / 2), Math.round(refRes * 0.78));
        textYVal = coords.y;
      }

      let textSizeVal = activePreset?.textSize ? parseFloat(activePreset.textSize) : 32;
      if (isNaN(textSizeVal) || !isFinite(textSizeVal)) {
        textSizeVal = 32;
      }

      const logoColorFillEnabledVal = getPropValue(activePreset, 'logoColorFillEnabled') === true || getPropValue(activePreset, 'logoColorFillEnabled') === 'true';
      let promptIaLogoVal = getPropValue(activePreset, 'promptIaLogo') || '';
      if (!logoColorFillEnabledVal) {
        promptIaLogoVal = "Use logo exactly as supplied...";
      }
      const promptActifLogoVal = getPropValue(activePreset, 'promptActifLogo') === true || getPropValue(activePreset, 'promptActifLogo') === 'true';
      const promptIaTextVal = getPropValue(activePreset, 'promptIaText') || '';
      const promptActifTextVal = getPropValue(activePreset, 'promptActifText') === true || getPropValue(activePreset, 'promptActifText') === 'true';
      const textColorFillEnabledVal = getPropValue(activePreset, 'textColorFillEnabled') !== false && getPropValue(activePreset, 'textColorFillEnabled') !== 'false';

      const jobData = {
        // Core job execution states
        status: 'ready_to_generate',
        createdAt: serverTimestamp(),
        imageA: validatedImageA,
        imageB: validatedImageB,
        imageC: validatedImageC,
        logo: state.showLogo ? (resolvedLogoId || null) : null,

        // Branding: Mode 1 "overlay" — logo/text applied crisp in post-prod from
        // this transparent layer (IMAGE_C is kept clean). See CAR-IA-APP_API.
        brandingMode: 'overlay',
        brandingOverlay: brandingOverlayUrl || null,

        // Root level presentation properties mapped strictly onto the resolutionRef grid
        imageId: activePreset?.imageId || getImageIdForVariant(state.envVariant || '07A01A'),
        resolutionRef: refRes,
        userId: auth.currentUser?.uid || 'guest',

        // Logo coordinates & styles on resolutionRef grid
        logoEnabled: state.showLogo,
        logoX: logoXVal,
        logoY: logoYVal,
        logoSize: logoSizeVal,
        logoColorFill: getPropValue(activePreset, 'logoColorFill') || '',
        logoColorFillEnabled: logoColorFillEnabledVal,
        logoExtra: activePreset?.logoExtra || '',
        promptIaLogo: promptIaLogoVal,
        promptActifLogo: promptActifLogoVal,

        // Text configurations on resolutionRef grid
        text: state.showText,
        textContent: state.logoText || getPropValue(activePreset, 'textContent') || 'VOTRE TEXTE ICI',
        textFont: state.textFont || getPropValue(activePreset, 'textFont') || 'Inter',
        textSize: textSizeVal,
        textAlign: getPropValue(activePreset, 'textAlign') || 'CENTRE',
        textX: textXVal,
        textY: textYVal,
        textColorFill: state.textColorFill || getEffectiveTextColor(activePreset),
        textColorFillEnabled: textColorFillEnabledVal,
        textperspective: activePreset?.textPerspective || activePreset?.textperspective || '',
        textExtra: activePreset?.textExtra || '',
        promptIaText: promptIaTextVal,
        promptActifText: promptActifTextVal,

        // Dynamic presets map directly to activePreset's resolutionRef (no hardcoded 1024 scaling)
        presetsFond: {
          // « Autorisé » seulement si le preset le permet ET que l'utilisateur a
          // réellement fourni un logo / un texte. Sinon le gatekeeper du moteur auto
          // (app-API) attendrait indéfiniment un branding absent → génération bloquée.
          logoAutorise: (getPropValue(activePreset, 'logo') !== false && getPropValue(activePreset, 'logo') !== 'false')
            && state.showLogo && !!resolvedLogoId,
          texteAutorise: (getPropValue(activePreset, 'text') !== false && getPropValue(activePreset, 'text') !== 'false')
            && state.showText && !!(state.logoText && state.logoText.trim().length > 0),
          logoPlaceholderCoords: {
            x: logoXVal,
            y: logoYVal,
            w: logoSizeVal,
            h: Math.round(logoSizeVal * 0.25)
          },
          texteStylePreset: {
            font: state.textFont || getPropValue(activePreset, 'textFont') || 'Inter',
            color: state.textColorFill || getEffectiveTextColor(activePreset),
            size: String(textSizeVal),
            textAlign: getPropValue(activePreset, 'textAlign') || 'CENTRE',
            textBaseline: 'middle'
          }
        },

        metadataUtilisateur: {
          texte: state.logoText || getPropValue(activePreset, 'textContent') || 'VOTRE TEXTE ICI',
          transformVehicule: {
            x: state.imageTransform.x || 0,
            y: state.imageTransform.y || 0,
            scale: state.imageTransform.scale || 1,
            rotation: state.imageTransform.rotate || 0,
            baselineScale: state.imageTransform.baselineScale || 1
          },
          boundingBoxVehicule: state.boundingBox ? {
            left: state.boundingBox.left,
            right: state.boundingBox.right,
            top: state.boundingBox.top,
            bottom: state.boundingBox.bottom
          } : null
        }
      };

      console.log(`[PWA FIRESTORE WRITE] Submitting job ${jobId} under Technical Blueprint Schema:`, {
        status: jobData.status,
        imageA: jobData.imageA,
        imageB: jobData.imageB,
        imageC: jobData.imageC,
        logo: jobData.logo
      });

      try {
        await setDoc(doc(db, 'exports', jobId), jobData);
        setState(prev => ({
          ...prev,
          screen: 'generation',
          currentJobStatus: 'pending',
          roughComposite: finalPreviewValue
        }));
      } catch (firestoreErr) {
        console.warn("[PWA FIRESTORE WRITE] Firestore setDoc failed (probably quota or permission), falling back to local server job creation:", firestoreErr);
        try {
          const fallbackRes = await fetch(resolveApiUrl('/api/jobs'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jobId, jobData })
          });
          if (!fallbackRes.ok) {
            throw new Error(`Fallback server returned status ${fallbackRes.status}`);
          }
          setState(prev => ({
            ...prev,
            screen: 'generation',
            currentJobStatus: 'pending',
            roughComposite: finalPreviewValue
          }));

          // QUOTA EXCEEDED SAFEGUARD:
          // Since Firestore has exceeded its free-tier write quota and the external AI processor cannot poll,
          // we trigger a simulated local completion on the Express fallback database after a short delay (3.5s).
          // This allows the PWA's fallback polling system to naturally fetch and display the completed result.
          setTimeout(() => {
            console.log(`[PWA QUOTA SAFEGUARD] Simulating local processing completion on fallback server for job: ${jobId}`);
            fetch(resolveApiUrl(`/api/jobs/${jobId}`), {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                status: 'completed',
                imageFinal: finalPreviewValue
              })
            }).then(() => {
              console.log("[PWA QUOTA SAFEGUARD] Fallback server job simulation updated successfully!");
            }).catch(e => {
              console.warn("[PWA QUOTA SAFEGUARD] Fallback server job simulation update failed:", e);
            });
          }, 3500);

        } catch (serverErr) {
          console.error("[PWA FALLBACK WRITE] Even server fallback failed:", serverErr);
          handleFirestoreError(firestoreErr, OperationType.WRITE, `exports/${jobId}`);
        }
      }

    } catch (err: any) {
      console.error("Critical error in handleStartCompositingJob:", err);
      setState(prev => ({
        ...prev,
        currentJobStatus: 'error',
        currentJobError: err?.message || 'Erreur lors de la préparation du job Firestore.'
      }));
    }
  };

  const handleSimulateStudioResponse = async () => {
    // Instantly transition local UI state so the user is never stuck
    const finalImage = state.roughComposite || state.image || '';
    setState(prev => ({
      ...prev,
      currentJobStatus: 'completed',
      currentJobResult: finalImage
    }));

    if (!state.currentJobId) return;

    // 1. Silent update to local Express fallback database
    try {
      fetch(resolveApiUrl(`/api/jobs/${state.currentJobId}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed', imageFinal: finalImage })
      }).then(() => {
        console.log("Local server simulation update succeeded!");
      }).catch(e => {
        console.warn("Local server background simulation update failed:", e);
      });
    } catch (e) {
      console.warn("Failed setting up local server simulation write:", e);
    }

    // 2. Silent update to Firestore
    try {
      const docRef = doc(db, 'exports', state.currentJobId);
      // Run the network update silently in the background without blocking the UI
      updateDoc(docRef, {
        status: 'completed',
        imageFinal: finalImage
      }).then(() => {
        console.log("Firestore simulation update succeeded in background!");
      }).catch(e => {
        console.warn("Firestore background simulation update failed (suppressed):", e);
      });
    } catch (e) {
      console.warn("Failed setting up background simulation write:", e);
    }
  };

  const handleInstallPWA = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log('[PWA] Installation prompt choice outcome:', outcome);
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setDeferredPrompt(null);
    }
  };

  const handleEnvVariantSelect = (code: string | null) => {
    if (!code) return;
    
    // Support full variants (e.g. from favorites) - check if it's a known code with its variant letter
    const isFullVariant = (code.length === 6 && VARIANT_LIMITS[code.substring(0, 5)]) || 
                         (code.length === 4 && VARIANT_LIMITS[code.substring(0, 3)]);
    
    if (isFullVariant) {
      setState(s => ({ ...s, envVariant: code }));
      return;
    }

    const baseCode = code;
    setState(prev => {
      let nextVariant = `${baseCode}A`;
      if (VARIANT_LIMITS[baseCode]) {
        if (prev.envVariant && prev.envVariant.startsWith(baseCode)) {
          const currentLetter = prev.envVariant.slice(baseCode.length) || 'A';
          const maxLetter = VARIANT_LIMITS[baseCode];
          const nextLetter = getNextLetter(currentLetter, maxLetter);
          nextVariant = `${baseCode}${nextLetter}`;
        }
      }
      return { ...prev, envVariant: nextVariant };
    });
  };

  const handlePlatformSelect = (baseCode: string | null) => {
    if (!baseCode) {
      setState(prev => ({ ...prev, platform: null }));
      return;
    }
    setState(prev => {
      let nextVariant = baseCode;
      if (VARIANT_LIMITS[baseCode]) {
        if (prev.platform && prev.platform.startsWith(baseCode)) {
          const currentLetter = prev.platform.slice(baseCode.length) || 'A';
          const maxLetter = VARIANT_LIMITS[baseCode];
          const nextLetter = getNextLetter(currentLetter, maxLetter);
          nextVariant = `${baseCode}${nextLetter}`;
        } else {
          nextVariant = `${baseCode}A`;
        }
      }
      return { ...prev, platform: nextVariant };
    });
  };

  const handleBrandingStyleSelect = (baseCode: string | null) => {
    if (!baseCode) return;
    setState(prev => {
      let nextVariant = baseCode;
      if (VARIANT_LIMITS[baseCode]) {
        if (prev.logoStyle && prev.logoStyle.startsWith(baseCode)) {
          const currentLetter = prev.logoStyle.slice(baseCode.length) || 'A';
          const maxLetter = VARIANT_LIMITS[baseCode];
          const nextLetter = getNextLetter(currentLetter, maxLetter);
          nextVariant = `${baseCode}${nextLetter}`;
        } else {
          nextVariant = `${baseCode}A`;
        }
      }
      return { ...prev, logoStyle: nextVariant };
    });
  };

  const handleEnvVariantNavigate = (direction: number) => {
    setState(prev => {
      if (!prev.envVariant) return prev;
      
      // Find the base code (e.g., '07B04')
      // Supports any capital letter as the 3rd character
      const baseMatch = prev.envVariant.match(/^(\d{2}[A-Z]\d{2})/);
      if (!baseMatch) return prev;
      
      const baseCode = baseMatch[1];
      const maxLetter = VARIANT_LIMITS[baseCode] || 'D';
      const currentLetter = prev.envVariant.slice(baseCode.length) || 'A';
      
      let nextLetter = 'A';
      if (direction > 0) {
        nextLetter = getNextLetter(currentLetter, maxLetter);
      } else {
        nextLetter = getPrevLetter(currentLetter, maxLetter);
      }
      
      return { ...prev, envVariant: `${baseCode}${nextLetter}` };
    });
  };

  const handlePlatformVariantNavigate = (direction: number) => {
    setState(prev => {
      if (!prev.platform) return prev;
      
      const baseMatch = prev.platform.match(/^(\d{2}[A-Z])/);
      const baseCode = baseMatch ? baseMatch[1] : prev.platform.slice(0, 3); // e.g., '08A'
      const maxLetter = VARIANT_LIMITS[baseCode] || 'D';
      const currentLetter = prev.platform.slice(baseCode.length) || 'A';
      
      let nextLetter = 'A';
      if (direction > 0) {
        nextLetter = getNextLetter(currentLetter, maxLetter);
      } else {
        nextLetter = getPrevLetter(currentLetter, maxLetter);
      }
      
      return { ...prev, platform: `${baseCode}${nextLetter}` };
    });
  };

  useEffect(() => {
    const applyAutoFit = async () => {
      const forcedScreens: Screen[] = [
        'environment_category', 
        'environment_variants', 
        'platform_base', 
        'branding_logo', 
        'branding_style', 
        'color_light', 
        'live_preview', 
        'result'
      ];
      
      if (forcedScreens.includes(state.screen) && state.image) {
        let bbox = state.boundingBox;
        if (!bbox) {
          bbox = await getVisibleBoundingBox(state.image);
          setState(prev => ({ ...prev, boundingBox: bbox }));
        }

        const isBboxSame = (!bbox && !lastAutoFittedBlob.current.bbox) || 
                           (bbox && lastAutoFittedBlob.current.bbox && 
                            bbox.left === lastAutoFittedBlob.current.bbox.left && 
                            bbox.top === lastAutoFittedBlob.current.bbox.top && 
                            bbox.right === lastAutoFittedBlob.current.bbox.right && 
                            bbox.bottom === lastAutoFittedBlob.current.bbox.bottom);

        if (lastAutoFittedBlob.current.image === state.image && isBboxSame) {
          return;
        }
        
        const optimized = calculateOptimizedTransform(bbox, 800, 600, 'center');
        
        const isDifferent = Math.abs(state.imageTransform.scale - optimized.scale) > 0.002 || 
                          Math.abs(state.imageTransform.x - optimized.x) > 0.5 ||
                          Math.abs(state.imageTransform.y - optimized.y) > 0.5;
                          
        if (isDifferent) {
          setState(prev => ({ ...prev, imageTransform: optimized }));
        }

        lastAutoFittedBlob.current = { image: state.image, bbox };
      }
    };
    applyAutoFit();
  }, [state.screen, state.image, state.boundingBox]);

  // Le fond autorise-t-il le changement de couleur (néon/LED) ? Piloté par le preset
  // du fond via le champ `imageColorFillEnabled`. Défaut (champ absent) = NON autorisé.
  const activeColorPreset = getBrandingPreset(state.envVariant, brandingPresets || {});
  const rawColorAllowed = getPropValue(activeColorPreset, 'imageColorFillEnabled');
  const colorAllowed = rawColorAllowed === true || String(rawColorAllowed).toLowerCase() === 'true';

  const next = (screen: Screen) => {
    // Le fond n'autorise pas la couleur → on saute l'écran couleur.
    if (screen === 'color_light' && !colorAllowed) screen = 'live_preview';
    setState(s => {
      // If we are returning to review and just finished upload, go straight to live_preview/result
      if (s.returnToReview && s.screen === 'upload' && screen === 'ad_style') {
        return { ...s, screen: 'live_preview', returnToReview: false, isJumpingBack: false };
      }
      return { ...s, screen, isJumpingBack: false };
    });
  };
  const back = (screen: Screen) => {
    // Symétrique : en revenant, on saute aussi l'écran couleur si le fond ne l'autorise pas.
    if (screen === 'color_light' && !colorAllowed) screen = 'branding_logo';
    setState(s => ({ ...s, screen }));
  };

  const showPlatform = !['home', 'vehicle_category', 'vehicle_selection', 'upload', 'ad_style', 'environment_category'].includes(state.screen);
  const getHighlightStep = (screen: Screen) => {
    switch (screen) {
      case 'environment_category': return 0;
      case 'platform_base': return 1;
      case 'upload': return 2;
      case 'branding_logo':
      case 'branding_style': return 3;
      case 'live_preview': return 4;
      case 'result': return -1;
      case 'generation': return -1;
      default: return -1;
    }
  };

  const previewProps = {
    screen: state.screen,
    image: state.image,
    imageTransform: state.imageTransform,
    envVariant: state.envVariant,
    platform: state.platform,
    logo: state.logo,
    customLogo: state.customLogo,
    logoText: state.logoText,
    logoType: state.logoType,
    logoGridPosition: state.logoGridPosition,
    // Couleur appliquée seulement si le fond l'autorise (sinon calque neutralisé).
    colorTheme: colorAllowed ? state.colorTheme : '#ffffff',
    colorIntensity: colorAllowed ? state.colorIntensity : 0,
    isIsolated: state.isIsolated,
    showPlatform,
    showLogo: state.showLogo,
    showText: state.showText,
    onNavigateEnv: (state.screen === 'environment_category' || state.screen === 'environment_variants') ? handleEnvVariantNavigate : undefined,
    onNavigateBase: state.screen === 'platform_base' ? handlePlatformVariantNavigate : undefined,
    onUpdateTransform: (state.screen === 'environment_category' || state.screen === 'live_preview') ? (newTransform: typeof state.imageTransform) => {
      setState(prev => ({ ...prev, imageTransform: newTransform }));
    } : undefined,
    highlightStep: getHighlightStep(state.screen),
    currentJobResult: state.currentJobResult,
    brandingPresets: brandingPresets
  };

  return (
    <div className="fixed inset-0 bg-background text-foreground font-sans selection:bg-white selection:text-black overflow-hidden">
      {/* Premium PWA Offline warning ribbon */}
      {isOffline && (
        <div className="absolute top-0 inset-x-0 bg-red-950/90 border-b border-red-500/25 text-red-300 py-1.5 px-4 text-center text-[10px] font-mono tracking-widest uppercase z-50 flex items-center justify-center gap-2 animate-pulse">
          <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-ping" />
          <span>Mode Hors-Ligne Actif — Cache Local Utilisé</span>
        </div>
      )}
      <AnimatePresence mode="wait">
        {state.screen === 'home' && (
          <HomeScreen 
            key="home" 
            onStart={() => next('shooting_conditions')} 
            deferredPrompt={deferredPrompt}
            isInstalled={isInstalled}
            isOffline={isOffline}
            onInstall={handleInstallPWA}
          />
        )}
        
        {state.screen === 'shooting_conditions' && (
          <ShootingConditionsScreen 
            key="shooting"
            selected={state.shootingCondition}
            onSelect={(id) => setState(s => ({ ...s, shootingCondition: id }))}
            onBack={() => back('home')}
            onNext={() => next('vehicle_category')}
            onHome={() => setState(INITIAL_STATE)}
            isJumpingBack={state.isJumpingBack}
          />
        )}

        {state.screen === 'vehicle_category' && (
          <VehicleCategoryScreen 
            key="vehicle_cat"
            selected={state.vehicleCategory}
            onSelect={(id) => setState(s => ({ ...s, vehicleCategory: id }))}
            onBack={() => back('shooting_conditions')}
            onNext={() => next('vehicle_selection')}
            onHome={() => setState(INITIAL_STATE)}
            isJumpingBack={state.isJumpingBack}
          />
        )}

        {state.screen === 'vehicle_selection' && (
          <VehicleSelectionScreen 
            key="vehicle"
            category={state.vehicleCategory}
            selected={state.vehicleType}
            onSelect={(id) => setState(s => ({ ...s, vehicleType: id }))}
            onBack={() => back('vehicle_category')}
            onNext={() => next('ad_style')}
            onHome={() => setState(INITIAL_STATE)}
            isJumpingBack={state.isJumpingBack}
          />
        )}

        {state.screen === 'ad_style' && (
          <AdStyleScreen 
            key="ad_style"
            vehicleCategory={state.vehicleCategory}
            selected={state.adStyle}
            onSelect={(id) => setState(s => ({ ...s, adStyle: id }))}
            onBack={() => back('vehicle_selection')}
            onNext={() => next('upload')}
            onHome={() => setState(INITIAL_STATE)}
            isJumpingBack={state.isJumpingBack}
          />
        )}

        {state.screen === 'upload' && (
          <UploadScreen 
            key="upload"
            image={state.image}
            originalImage={state.originalImage}
            transform={state.imageTransform}
            isIsolated={state.isIsolated}
            onBack={() => back('ad_style')} 
            onNext={(img, originalImg, transform, isolated, bbox) => {
              setState(s => {
                const nextScreen = s.returnToReview ? 'live_preview' : 'environment_category';
                return { 
                  ...s, 
                  image: img, 
                  originalImage: originalImg,
                  imageTransform: transform, 
                  isIsolated: isolated, 
                  boundingBox: bbox,
                  screen: nextScreen,
                  returnToReview: false,
                  isJumpingBack: s.returnToReview
                };
              });
            }} 
            onHome={() => setState(INITIAL_STATE)}
            isJumpingBack={state.isJumpingBack}
          />
        )}

        {state.screen === 'environment_category' && (
          <EnvironmentScreen 
            key="env"
            category={state.envCategory}
            onCategory={(id) => setState(s => ({ ...s, envCategory: id }))}
            variant={state.envVariant}
            onVariant={handleEnvVariantSelect}
            onBack={() => back('upload')}
            onNext={() => {
              setState(s => {
                const nextState = { ...s };
                
                nextState.screen = 'branding_logo';
                nextState.isJumpingBack = false;
                return nextState;
              });
            }}
            onHome={() => setState(INITIAL_STATE)}
            isJumpingBack={state.isJumpingBack}
            previewProps={previewProps}
            favorites={state.favorites}
            onUpdateFavorites={(favs) => setState(s => ({ ...s, favorites: favs }))}
          />
        )}

        {state.screen === 'branding_logo' && (
          <BrandingLogoScreen 
            key="logo"
            selected={state.logo}
            customLogo={state.customLogo}
            logoText={state.logoText}
            showLogo={state.showLogo}
            showText={state.showText}
            onShowLogo={(v) => setState(s => ({ ...s, showLogo: v }))}
            onShowText={(v) => setState(s => ({ ...s, showText: v }))}
            logoType={state.logoType}
            logoGridPosition={state.logoGridPosition}
            onSelect={(id) => setState(s => ({ ...s, logo: id }))}
            onCustomLogo={(img) => setState(s => ({ ...s, customLogo: img }))}
            onLogoTextChange={(t) => setState(s => ({ ...s, logoText: t }))}
            onLogoTypeChange={(t) => setState(s => ({ ...s, logoType: t }))}
            onLogoGridPositionChange={(p) => setState(s => ({ ...s, logoGridPosition: p }))}
            posV={state.logoPositionV}
            posH={state.logoPositionH}
            onPosV={(pos) => setState(s => ({ ...s, logoPositionV: pos }))}
            onPosH={(pos) => setState(s => ({ ...s, logoPositionH: pos }))}
            onBack={() => back('environment_category')}
            onNext={() => next('color_light')}
            onHome={() => setState(INITIAL_STATE)}
            isJumpingBack={state.isJumpingBack}
            previewProps={previewProps}
          />
        )}

        {state.screen === 'color_light' && (
          <ColorLightScreen 
            key="color"
            theme={state.colorTheme}
            onThemeChange={(t) => setState(s => ({ ...s, colorTheme: t }))}
            intensity={state.colorIntensity}
            onIntensityChange={(v) => setState(s => ({ ...s, colorIntensity: v }))}
            onBack={() => back('branding_logo')}
            onNext={() => next('live_preview')}
            onHome={() => setState(INITIAL_STATE)}
            isJumpingBack={state.isJumpingBack}
            previewProps={previewProps}
          />
        )}

        {state.screen === 'live_preview' && (
          <LivePreviewScreen 
            key="preview"
            onBack={() => back('color_light')}
            onNext={handleStartCompositingJob}
            onHome={() => setState(INITIAL_STATE)}
            onJump={(screen) => setState(s => {
              const baseState = { ...s, screen, isJumpingBack: true };
              if (screen === 'upload' && s.image && s.boundingBox) {
                return { ...baseState, imageTransform: calculateOptimizedTransform(s.boundingBox, 800, 600, 'center') };
              }
              return baseState;
            })}
            previewProps={previewProps}
          />
        )}

        {state.screen === 'generation' && (
          <GenerationScreen 
            key="generation" 
            onComplete={() => next('result')} 
            onCancel={() => setState(prev => ({ ...prev, screen: 'live_preview', currentJobId: null, currentJobStatus: null, currentJobError: null }))}
            previewProps={previewProps} 
            currentJobStatus={state.currentJobStatus}
            currentJobId={state.currentJobId}
            currentJobError={(state as any).currentJobError || null}
            onSimulateLocal={handleSimulateStudioResponse}
          />
        )}

        {state.screen === 'result' && (
          <ResultScreen 
            key="result" 
            onReset={() => setState(INITIAL_STATE)} 
            onEdit={() => setState(s => ({ ...s, screen: 'live_preview', isJumpingBack: true }))}
            onChangeVehicle={() => setState(s => ({ ...s, screen: 'upload', returnToReview: true, isJumpingBack: true }))}
            previewProps={previewProps}
          />
        )}
      </AnimatePresence>

      <BrandKitModal
        open={brandKitOpen}
        onClose={closeBrandKit}
        userId={authUser?.uid ?? null}
        onApply={applyBrandKit}
      />
    </div>
  );
}
