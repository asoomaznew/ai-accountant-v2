import fs from 'fs';
import path from 'path';

const outputFile = 'components/all_code.txt';
const filesToInclude = [
  'package.json',
  'tsconfig.json',
  'vite.config.ts',
  'index.html',
  'index.tsx',
  'metadata.json',
  'types.ts',
  'constants.ts',
  'warbaConstants.ts',
  ...fs.readdirSync('services').filter(f => f.endsWith('.ts')).map(f => `services/${f}`),
  ...fs.readdirSync('components').filter(f => f.endsWith('.tsx')).map(f => `components/${f}`),
  'App.tsx'
];

let output = '';

for (const file of filesToInclude) {
  if (file.includes('icons.tsx') || file.includes('all_code.txt')) {
    continue;
  }
  if (fs.existsSync(file)) {
    output += `========================================\n`;
    output += ` FILE: ${file}\n`;
    output += `========================================\n`;
    output += fs.readFileSync(file, 'utf8') + '\n\n';
  }
}

fs.writeFileSync(outputFile, output);
console.log('all_code.txt updated!');
