export type Screen = 
  | 'home' 
  | 'shooting_conditions'
  | 'upload' 
  | 'ad_style'
  | 'vehicle_category'
  | 'vehicle_selection' 
  | 'environment_category' 
  | 'environment_variants' 
  | 'platform_base' 
  | 'branding_logo' 
  | 'branding_style' 
  | 'color_light' 
  | 'live_preview' 
  | 'generation' 
  | 'result';

export type LogoPositionV = 'top' | 'bottom' | 'integrated';
export type LogoPositionH = 'left' | 'right' | 'center';

export interface AppState {
  screen: Screen;
  isJumpingBack: boolean;
  image: string | null;
  originalImage: string | null;
  imageTransform: {
    x: number;
    y: number;
    scale: number;
    rotate: number;
    baselineScale?: number;
  };
  vehicleCategory: 'car' | 'utility' | 'bike' | null;
  vehicleType: string | null;
  envCategory: string | null;
  envVariant: string | null;
  platform: string | null;
  logo: string | null;
  customLogo: string | null;
  logoText: string;
  logoType: 'upload' | 'text' | null;
  logoGridPosition: number | null;
  logoPositionV: LogoPositionV | null;
  logoPositionH: LogoPositionH | null;
  logoStyle: string | null;
  plateText: string;
  plateType: 'text' | 'logo' | 'empty';
  plateColor: string;
  plateLogo: string | null;
  plateFont: string;
  colorTheme: string;
  lightMode: 'neutral' | 'warm' | 'cool' | 'high_contrast';
  isIsolated: boolean;
  boundingBox: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
    imgW: number;
    imgH: number;
  } | null;
  adStyle: string | null;
  shootingCondition: 'moving_vehicle' | 'moving_camera' | null;
  colorIntensity: number;
  showLogo: boolean;
  showText: boolean;
  returnToReview: boolean;
  favorites: ({ envCategory: string | null; envVariant: string | null } | null)[];
  currentJobId: string | null;
  currentJobStatus: 'pending' | 'processing' | 'completed' | 'error' | null;
  currentJobResult: string | null;
  currentJobError: string | null;
  roughComposite: string | null;
}

export const INITIAL_STATE: AppState = {
  screen: 'home',
  isJumpingBack: false,
  image: null,
  originalImage: null,
  imageTransform: {
    x: 0,
    y: 0,
    scale: 1.0,
    rotate: 0,
  },
  vehicleCategory: null,
  vehicleType: null,
  envCategory: 'urban',
  envVariant: '07A01A',
  platform: null,
  logo: null,
  customLogo: null,
  logoText: '',
  logoType: null,
  logoGridPosition: 10,
  logoPositionV: 'bottom',
  logoPositionH: 'center',
  logoStyle: '10AA',
  plateText: '',
  plateType: 'empty',
  plateColor: '#ffffff',
  plateLogo: null,
  plateFont: 'Inter',
  colorTheme: '#ffffff',
  colorIntensity: 1,
  lightMode: 'neutral',
  isIsolated: false,
  boundingBox: null,
  adStyle: null,
  shootingCondition: 'moving_vehicle',
  showLogo: false,
  showText: false,
  returnToReview: false,
  favorites: Array(10).fill(null),
  currentJobId: null,
  currentJobStatus: null,
  currentJobResult: null,
  currentJobError: null,
  roughComposite: null,
};
