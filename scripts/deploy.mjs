#!/usr/bin/env node

/**
 * Deploy script: Builds the site and copies to gh-pages worktree
 * Preserves the .git file in the worktree to maintain worktree functionality
 */

import { execSync } from 'child_process';
import { existsSync, cpSync, rmSync, writeFileSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');
const pagesDir = join(repoRoot, 'pages');
const distDir = join(repoRoot, 'dist');

function exec(command, options = {}) {
  try {
    return execSync(command, { 
      cwd: repoRoot, 
      encoding: 'utf-8',
      stdio: 'inherit',
      ...options 
    });
  } catch (error) {
    console.error(`Error executing: ${command}`);
    process.exit(1);
  }
}

// Check if pages worktree exists
if (!existsSync(pagesDir)) {
  console.error('❌ Error: pages/ worktree does not exist');
  console.log('Create it with: git worktree add pages gh-pages');
  process.exit(1);
}

// Check if .git file exists in pages (required for worktree)
const gitFile = join(pagesDir, '.git');
if (!existsSync(gitFile)) {
  console.error('❌ Error: pages/.git file missing - worktree is broken');
  console.log('Recreate the worktree with: git worktree remove pages && git worktree add pages gh-pages');
  process.exit(1);
}

console.log('🔨 Building site...');
exec('pnpm build');

if (!existsSync(distDir)) {
  console.error('❌ Error: Build output not found in dist/');
  process.exit(1);
}

console.log('📦 Copying build output to pages/ worktree...');

// Save the .git file temporarily
const gitFileBackup = join(repoRoot, '.git.pages.backup');
cpSync(gitFile, gitFileBackup);

// Remove everything in pages except .git
const filesToKeep = ['.git'];
const allFiles = execSync(`ls -A "${pagesDir}"`, { encoding: 'utf-8', cwd: repoRoot })
  .trim()
  .split('\n')
  .filter(f => f && !filesToKeep.includes(f));

for (const file of allFiles) {
  const filePath = join(pagesDir, file);
  rmSync(filePath, { recursive: true, force: true });
}

// Copy dist contents to pages
cpSync(distDir, pagesDir, { recursive: true });

// Create .nojekyll file to disable Jekyll processing on GitHub Pages
const nojekyllFile = join(pagesDir, '.nojekyll');
writeFileSync(nojekyllFile, '');

// Restore the .git file
cpSync(gitFileBackup, gitFile);
rmSync(gitFileBackup);

console.log('✅ Build copied to pages/ worktree');
console.log('✅ Created .nojekyll file');
console.log('\n📝 Next steps:');
console.log('   cd pages');
console.log('   git add .');
console.log('   git commit -m "Deploy: update site"');
console.log('   git push origin gh-pages');