import fs from 'fs';
import path from 'path';
import https from 'https';

const assetsDir = path.join(process.cwd(), 'public', 'assets');

async function download(url: string, filename: string) {
  const targetPath = path.join(assetsDir, filename);
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return download(res.headers.location!, filename).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        reject(new Error(`Failed ${res.statusCode}`));
        return;
      }
      const fsStream = fs.createWriteStream(targetPath);
      res.pipe(fsStream);
      fsStream.on('finish', () => {
        fsStream.close();
        resolve(true);
      });
    }).on('error', reject);
  });
}

download("https://images.unsplash.com/photo-1586191582056-a15cd117d1ee?q=80&w=2070&auto=format&fit=crop", "03B04.jpg")
  .then(() => console.log("Fixed 03B04.jpg"))
  .catch(console.error);
