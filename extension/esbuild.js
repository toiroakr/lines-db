const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

// Copy HTML template to dist
function copyHtmlTemplate() {
  const srcPath = path.join(__dirname, 'src', 'preview-template.html');
  const distPath = path.join(__dirname, 'dist', 'preview-template.html');

  // Ensure dist directory exists
  const distDir = path.join(__dirname, 'dist');
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  fs.copyFileSync(srcPath, distPath);
  console.log('[build] copied preview-template.html to dist/');
}

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    outfile: 'dist/extension.js',
    external: ['vscode'],
    logLevel: 'silent',
    plugins: [
      {
        name: 'watch-plugin',
        setup(build) {
          build.onEnd((result) => {
            console.log(
              result.errors.length > 0 ? `[watch] build failed` : `[watch] build finished`,
            );
            // Copy HTML template after each build
            if (result.errors.length === 0) {
              copyHtmlTemplate();
            }
          });
        },
      },
    ],
  });

  if (watch) {
    await ctx.watch();
    console.log('[watch] build started');
  } else {
    await ctx.rebuild();
    copyHtmlTemplate();
    await ctx.dispose();
    console.log('[build] build finished');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
