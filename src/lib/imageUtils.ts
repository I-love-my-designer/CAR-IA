
export interface BoundingBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  imgW: number;
  imgH: number;
}

export async function getVisibleBoundingBox(imageUrl: string): Promise<BoundingBox> {
  return new Promise<BoundingBox>((resolve) => {
    const img = new Image();
    if (imageUrl && !imageUrl.startsWith('data:')) {
      img.crossOrigin = "anonymous";
    }
    img.onload = () => {
      // Use a smaller canvas for analysis to significantly speed up processing
      const ANALYSIS_SIZE = 400; 
      const scaleX = ANALYSIS_SIZE / img.width;
      
      const analysisW = ANALYSIS_SIZE;
      const analysisH = Math.round(img.height * scaleX);
      
      const canvas = document.createElement('canvas');
      canvas.width = analysisW;
      canvas.height = analysisH;
      
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        resolve({ left: 0, top: 0, right: 1, bottom: 1, width: 1, height: 1, imgW: img.width, imgH: img.height });
        return;
      }
      
      ctx.drawImage(img, 0, 0, analysisW, analysisH);
      const imageData = ctx.getImageData(0, 0, analysisW, analysisH);
      const data = imageData.data;
      
      let left = analysisW, top = analysisH, right = 0, bottom = 0;
      let found = false;
      
      for (let y = 0; y < analysisH; y++) {
        for (let x = 0; x < analysisW; x++) {
          const alpha = data[(y * analysisW + x) * 4 + 3];
          if (alpha > 10) { 
            if (x < left) left = x;
            if (y < top) top = y;
            if (x > right) right = x;
            if (y > bottom) bottom = y;
            found = true;
          }
        }
      }
      
      if (!found) {
        resolve({ left: 0, top: 0, right: 1, bottom: 1, width: 1, height: 1, imgW: img.width, imgH: img.height });
        return;
      }
      
      resolve({
        left: left / analysisW,
        top: top / analysisH,
        right: right / analysisW,
        bottom: bottom / analysisH,
        width: (right - left) / analysisW,
        height: (bottom - top) / analysisH,
        imgW: img.width,
        imgH: img.height
      });
    };
    img.onerror = () => {
      resolve({ left: 0, top: 0, right: 1, bottom: 1, width: 1, height: 1, imgW: 0, imgH: 0 });
    };
    img.src = imageUrl;
  });
}

export function calculateOptimizedTransform(
  bbox: BoundingBox,
  previewW: number = 1280,
  previewH: number = 1280,
  alignment: 'center' | 'bottom' = 'bottom'
) {
  // We normalize calculations against the standard 1280x1280 square reference background.
  const refBgW = 1280;
  const refBgH = 1280;
  
  // Container size is 3/4 (75%) of the background container
  const cW = refBgW * 0.75; // 960 px
  const cH = refBgH * 0.75; // 960 px
  
  // Natural image dimensions
  const imgW = bbox.imgW;
  const imgH = bbox.imgH;
  
  const imgAspect = imgW / imgH;
  const cAspect = 1.0; // Square container 960x960
  
  // displayW/H: dimensions of the image pixels at scale 1 inside the object-contain container
  let displayW: number, displayH: number;
  if (imgAspect > cAspect) {
    displayW = cW;
    displayH = cW / imgAspect;
  } else {
    displayH = cH;
    displayW = cH * imgAspect;
  }
  
  // 900 pixels wide corresponds to the car body width at 100% scale (i.e., baselineScale)
  const targetVisibleW = 900; // Car body must end up exactly 900px wide
  
  const currentVisibleWUnscaled = displayW * bbox.width;
  
  // Calculate baseline scale factor to force vehicle body to be exactly 800px wide
  let bScale = 1.0;
  if (currentVisibleWUnscaled > 0) {
    bScale = targetVisibleW / currentVisibleWUnscaled;
  }
  
  // Compute absolute scale to apply during alignment calculations
  const absoluteScale = bScale;
  
  // 1. Horizontal Centering using the absolute baseline scale
  const nVisibleCenterX = (bbox.left + bbox.right) / 2;
  const currentVisibleCenterX = (refBgW / 2) + (displayW * absoluteScale * (nVisibleCenterX - 0.5));
  const xTranslatePx = (refBgW / 2) - currentVisibleCenterX;
  
  // 2. Vertical Alignment
  let yTranslatePx = 0;
  if (alignment === 'center') {
    const nVisibleCenterY = (bbox.top + bbox.bottom) / 2;
    const currentVisibleCenterY = (refBgH / 2) + (displayH * absoluteScale * (nVisibleCenterY - 0.5));
    yTranslatePx = (refBgH / 2) - currentVisibleCenterY;
  } else {
    // Bottom at 1/6 from bottom of the 1280px high canvas (approx 83.33% of height, i.e., 1066px)
    const currentVisibleBottomY = (refBgH / 2) + (displayH * absoluteScale * (bbox.bottom - 0.5));
    const targetVisibleBottomY = refBgH * 0.8333; // 1066.6px
    yTranslatePx = targetVisibleBottomY - currentVisibleBottomY;
  }

  // Safety: Ensure top doesn't go off-screen
  const currentVisibleTopY = (refBgH / 2) + (displayH * absoluteScale * (bbox.top - 0.5));
  const topAfterTranslate = currentVisibleTopY + yTranslatePx;
  if (topAfterTranslate < refBgH * 0.05) {
    yTranslatePx += (refBgH * 0.05 - topAfterTranslate);
  }
  
  // Convert to element-relative percentages (Tailwind/Framer % is relative to container size cW and cH)
  const xPercent = (xTranslatePx / cW) * 100;
  const yPercent = (yTranslatePx / cH) * 100;
  
  return {
    x: xPercent,
    y: yPercent,
    scale: 1.0, // User relative scale starts at 1.0 (100%)
    rotate: 0,
    baselineScale: bScale // Expose baseline scale for accurate canvas & UI scaling
  };
}
