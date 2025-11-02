const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

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
    external: ['vscode', 'lines-db'],
    logLevel: 'silent',
    plugins: [
      {
        name: 'watch-plugin',
        setup(build) {
          build.onEnd((result) => {
            console.log(
              result.errors.length > 0 ? `[watch] build failed` : `[watch] build finished`,
            );
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
    await ctx.dispose();
    console.log('[build] build finished');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
