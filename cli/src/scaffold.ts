import fs from 'fs-extra';
import path from 'path';
import kleur from 'kleur';
import type { Config } from './types.js';
import { generateRoot } from './templates/root.js';
import { generateProtocol } from './templates/protocol.js';
import { generateCore } from './templates/core.js';
import { generateLoader } from './templates/loader.js';
import { generateReact } from './templates/react.js';
import { generateWidget } from './templates/widget.js';
import { generateExample } from './templates/example.js';

type FileMap = Record<string, string>;

async function writeFiles(outDir: string, files: FileMap): Promise<void> {
  for (const [relPath, content] of Object.entries(files)) {
    const abs = path.join(outDir, relPath);
    await fs.ensureDir(path.dirname(abs));
    await fs.writeFile(abs, content, 'utf8');
  }
}

export async function scaffold(config: Config): Promise<void> {
  const { outDir, name } = config;

  if (await fs.pathExists(outDir)) {
    const isEmpty = (await fs.readdir(outDir)).length === 0;
    if (!isEmpty) {
      console.error(kleur.red(`\nDirectory "${name}" already exists and is not empty.\n`));
      process.exit(1);
    }
  }

  await fs.ensureDir(outDir);

  console.log(kleur.cyan('\nScaffolding your embed SDK...\n'));

  const steps: Array<[string, () => FileMap]> = [
    ['workspace root', () => generateRoot(config)],
    ['protocol package', () => generateProtocol(config)],
    ['core SDK package', () => generateCore(config)],
    ['loader (embed.js)', () => generateLoader(config)],
    ['widget app (Vite + React)', () => generateWidget(config)],
    ...(config.includeReact
      ? [['React adapter', () => generateReact(config)] as [string, () => FileMap]]
      : []),
    ...(config.includeExample
      ? [['example host app', () => generateExample(config)] as [string, () => FileMap]]
      : []),
  ];

  for (const [label, generate] of steps) {
    process.stdout.write(`  ${kleur.dim('→')} ${label}...`);
    const files = generate();
    await writeFiles(outDir, files);
    process.stdout.write(` ${kleur.green('✓')}\n`);
  }

  console.log(kleur.green('\n✓ Done!\n'));
  console.log(kleur.bold('Next steps:\n'));
  console.log(`  cd ${name}`);
  console.log('  pnpm install');
  console.log('  pnpm dev\n');
  console.log(kleur.dim('Packages created:'));
  console.log(kleur.dim(`  ${config.scope}/protocol  → message types + Zod schemas`));
  console.log(kleur.dim(`  ${config.scope}/core      → SDK lifecycle engine`));
  console.log(kleur.dim(`  ${config.scope}/loader    → embed.js (IIFE <script> tag)`));
  if (config.includeReact) {
    console.log(kleur.dim(`  ${config.scope}/react     → React hooks + Provider`));
  }
  console.log(kleur.dim(`  widget/             → Vite + React iframe app\n`));
}
