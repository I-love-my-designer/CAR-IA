import { initializeApp } from 'firebase/app';
import { getStorage, ref, listAll, getDownloadURL } from 'firebase/storage';
import { readFileSync } from 'fs';

const firebaseConfig = JSON.parse(readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const storage = getStorage(app);

async function testScan() {
  const possiblePaths = ['LOGOS', 'logos'];
  let foundLogos = [];

  async function listAllRecursive(dirRef, depth = 0) {
    if (depth > 4) return [];
    let results = [];
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
        const loaded = (await Promise.all(filePromises)).filter(x => x !== null);
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
      // Ignore
    }
    return results;
  }
  
  try {
    const dirRef = ref(storage, 'LOGOS');
    foundLogos = await listAllRecursive(dirRef);
  } catch (err) {
    console.warn("Parallel logo loading error:", err);
  }

  const unique = foundLogos.reduce((acc, current) => {
    const x = acc.find(item => item.name.toLowerCase() === current.name.toLowerCase());
    if (!x) {
      return acc.concat([current]);
    } else {
      return acc;
    }
  }, []);

  console.log(`TOTAL LOGOS FOUND: ${unique.length}`);
  unique.forEach((logo, idx) => {
    console.log(`${idx + 1}. name: "${logo.name}", url: "${logo.url.substring(0, 100)}..."`);
  });
}

testScan();
