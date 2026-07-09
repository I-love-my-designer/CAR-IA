import fs from 'fs';
import path from 'path';
import https from 'https';

const DEFAULT_IMAGES = {
  "01A": "https://images.unsplash.com/photo-1614162692292-7ac56d7f7f1e?q=80&w=2070&auto=format&fit=crop",
  "02A": "https://images.unsplash.com/photo-1511919884226-fd3cad34687c?q=80&w=2070&auto=format&fit=crop",
  "02B": "https://images.unsplash.com/photo-1503376780353-7e6692767b70?q=80&w=2070&auto=format&fit=crop",
  "03A": "https://images.unsplash.com/photo-1503376780353-7e6692767b70?q=80&w=2070&auto=format&fit=crop",
  "03B": "https://images.unsplash.com/photo-1580273916550-e323be2ae537?q=80&w=2070&auto=format&fit=crop",
  "03C": "https://images.unsplash.com/photo-1558981403-c5f9899a28bc?q=80&w=2070&auto=format&fit=crop",
  "03A01": "https://images.unsplash.com/photo-1441148345475-03a2e82f9719?q=80&w=2070&auto=format&fit=crop",
  "03A02": "https://images.unsplash.com/photo-1484399172022-72a90b12e3c1?q=80&w=2070&auto=format&fit=crop",
  "03A03": "https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?q=80&w=2070&auto=format&fit=crop",
  "03A04": "https://images.unsplash.com/photo-1544636331-e26879cd4d9b?q=80&w=2070&auto=format&fit=crop",
  "03A05": "https://images.unsplash.com/photo-1503376780353-7e6692767b70?q=80&w=2070&auto=format&fit=crop",
  "03A06": "https://images.unsplash.com/photo-1580273916550-e323be2ae537?q=80&w=2070&auto=format&fit=crop",
  "03B01": "https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?q=80&w=2070&auto=format&fit=crop",
  "03B02": "https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?q=80&w=2070&auto=format&fit=crop",
  "03B03": "https://images.unsplash.com/photo-1580273916550-e323be2ae537?q=80&w=2070&auto=format&fit=crop",
  "03B04": "https://images.unsplash.com/photo-1586191582056-a15cd117d1ee?q=80&w=2070&auto=format&fit=crop",
  "03C01": "https://images.unsplash.com/photo-1484399172022-72a90b12e3c1?q=80&w=2070&auto=format&fit=crop",
  "03C02": "https://images.unsplash.com/photo-1558981403-c5f9899a28bc?q=80&w=2070&auto=format&fit=crop",
  "03C03": "https://images.unsplash.com/photo-1558981403-c5f9899a28bc?q=80&w=2070&auto=format&fit=crop",
  "03C04": "https://images.unsplash.com/photo-1558981403-c5f9899a28bc?q=80&w=2070&auto=format&fit=crop",
  "05A": "https://images.unsplash.com/photo-1494976388531-d1058494cdd8?q=80&w=2070&auto=format&fit=crop",
  "05B": "https://images.unsplash.com/photo-1503376780353-7e6692767b70?q=80&w=2070&auto=format&fit=crop",
  "05C": "https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?q=80&w=2070&auto=format&fit=crop",
  "05D": "https://images.unsplash.com/photo-1555215695-3004980ad54e?q=80&w=2070&auto=format&fit=crop",
  "07A": "https://images.unsplash.com/photo-1514565131-fce0801e5785?q=80&w=2070&auto=format&fit=crop",
  "07B": "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?q=80&w=2070&auto=format&fit=crop",
  "07C": "https://images.unsplash.com/photo-1497366216548-37526070297c?q=80&w=2070&auto=format&fit=crop",
  "07D": "https://images.unsplash.com/photo-1550684848-fac1c5b4e853?q=80&w=2070&auto=format&fit=crop",
};

const assetsDir = path.join(process.cwd(), 'public', 'assets');

async function download(url: string, filename: string) {
  const targetPath = path.join(assetsDir, filename);
  // Unsplash redirects, so we need to follow redirects
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return download(res.headers.location!, filename).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to download ${url}: ${res.statusCode}`));
        return;
      }
      const fileStream = fs.createWriteStream(targetPath);
      res.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close();
        console.log(`Downloaded: ${filename}`);
        resolve(true);
      });
    }).on('error', reject);
  });
}

async function run() {
  console.log('Downloading assets...');
  for (const [code, url] of Object.entries(DEFAULT_IMAGES)) {
    const filename = `${code}.jpg`;
    const targetPath = path.join(assetsDir, filename);
    
    // Check if file already exists to avoid redundant downloads
    if (fs.existsSync(targetPath) && fs.statSync(targetPath).size > 0) {
      console.log(`Skipping: ${filename} (already exists)`);
      continue;
    }
    
    try {
      await download(url, filename);
    } catch (e) {
      console.error(`Error downloading ${filename}:`, e);
    }
  }
}

run();
