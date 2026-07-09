import fs from 'fs';
import path from 'path';

const assetsDir = path.join(process.cwd(), 'public', 'assets');
const files = fs.readdirSync(assetsDir);

console.log('File sizes in public/assets:');
files.forEach(file => {
  const stats = fs.statSync(path.join(assetsDir, file));
  console.log(`${file}: ${stats.size} bytes`);
});
