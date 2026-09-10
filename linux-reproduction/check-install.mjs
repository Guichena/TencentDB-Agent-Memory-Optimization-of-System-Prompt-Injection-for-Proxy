import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const locks = ['evaluation/MemoryProxy/package-lock.json', 'implementations/baseline/MemoryProxy/package-lock.json', 'implementations/final/MemoryProxy/package-lock.json', 'implementations/final/MemoryCore/pnpm-lock.yaml'];
for (const file of locks) {
  if (!existsSync(resolve(root,file))) throw Error('Missing frozen dependency file: '+file);
  if (process.argv.includes('--tracked')) execFileSync('git',['ls-files','--error-unmatch','--',file],{cwd:root,stdio:'pipe'});
  if (file.endsWith('package-lock.json')) {
    const lock=JSON.parse(readFileSync(resolve(root,file),'utf8'));
    const pkg=JSON.parse(readFileSync(resolve(root,dirname(file),'package.json'),'utf8'));
    for(const field of ['dependencies','devDependencies','optionalDependencies']) {
      const expected=pkg[field]??{}, actual=lock.packages?.['']?.[field]??{};
      for(const name of new Set([...Object.keys(expected),...Object.keys(actual)])) if(expected[name]!==actual[name]) throw Error(`Lock/manifest mismatch: ${file} ${field}.${name}`);
    }
  }
}
console.log('PASS: required dependency locks exist and npm root specifiers match'+(process.argv.includes('--tracked')?' (all tracked)':''));
