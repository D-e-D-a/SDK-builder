#!/usr/bin/env node
import { Command } from 'commander';
import kleur from 'kleur';
import { runPrompts } from './prompts.js';
import { scaffold } from './scaffold.js';

const program = new Command();

program
  .name('create-embed-sdk')
  .description('Scaffold a production-grade iframe embed SDK for any React + Vite app')
  .version('0.1.0')
  .argument('[project-name]', 'Project name (kebab-case)')
  .action(async (projectName?: string) => {
    console.log(kleur.bold().cyan('\ncreate-embed-sdk') + kleur.dim(' — iframe SDK scaffolder\n'));

    try {
      const config = await runPrompts(projectName);
      await scaffold(config);
    } catch (err) {
      console.error(kleur.red('\nError:'), err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program.parse();
