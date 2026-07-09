import { initializeApp } from 'firebase/app';
import { getStorage, ref, getDownloadURL } from 'firebase/storage';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));

const app = initializeApp(firebaseConfig);
const storage = getStorage(app);

const EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];
const FOLDERS = ['logos', 'LOGOS', 'marques', 'MARQUES', ''];
const FILENAMES = ['A', 'B', 'C', 'D', 'E'];

async function run() {
  console.log("Analyzing storage errors for files A-E...");
  for (const folder of FOLDERS) {
    for (const name of FILENAMES) {
      for (const ext of EXTENSIONS) {
        const path = folder ? `${folder}/${name}.${ext}` : `${name}.${ext}`;
        try {
          const fileRef = ref(storage, path);
          await getDownloadURL(fileRef);
          console.log(`[FOUND] Path matches: "${path}"`);
        } catch (err: any) {
          const code = err?.code || 'unknown';
          if (code !== 'storage/object-not-found') {
            console.log(`[EXISTS OR RULE BLOCKED] Path: "${path}" -> Error: ${code}`);
          }
        }
      }
    }
  }
}

run();
