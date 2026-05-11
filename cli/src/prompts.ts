import prompts from 'prompts';
import path from 'path';
import type { Config } from './types.js';

function toPascalCase(str: string): string {
  return str
    .replace(/[-_](.)/g, (_, c: string) => c.toUpperCase())
    .replace(/^(.)/, (_, c: string) => c.toUpperCase());
}

function toScope(name: string): string {
  return name.startsWith('@') ? name : `@${name}`;
}

export async function runPrompts(projectName?: string): Promise<Config> {
  const answers = await prompts(
    [
      {
        type: projectName ? null : 'text',
        name: 'name',
        message: 'Project name (kebab-case):',
        initial: 'my-embed-sdk',
        validate: (v: string) =>
          /^[a-z][a-z0-9-]*$/.test(v) || 'Use lowercase letters, numbers, and hyphens',
      },
      {
        type: 'text',
        name: 'widgetOrigin',
        message: 'Widget iframe origin (where your app will be hosted):',
        initial: 'http://localhost:5174',
        validate: (v: string) => {
          try {
            new URL(v);
            return true;
          } catch {
            return 'Enter a valid URL (e.g. https://widget.myapp.com)';
          }
        },
      },
      {
        type: 'text',
        name: 'description',
        message: 'Package description:',
        initial: 'Iframe embed SDK',
      },
      {
        type: 'text',
        name: 'author',
        message: 'Author:',
        initial: '',
      },
      {
        type: 'confirm',
        name: 'includeReact',
        message: 'Include React adapter package (@scope/react)?',
        initial: true,
      },
      {
        type: 'confirm',
        name: 'includeExample',
        message: 'Include example host app?',
        initial: true,
      },
    ],
    {
      onCancel: () => {
        process.exit(0);
      },
    }
  );

  const name = (projectName ?? answers.name) as string;
  const scope = toScope(name);
  const namespace = toPascalCase(name);

  return {
    name,
    scope,
    namespace,
    widgetOrigin: answers.widgetOrigin as string,
    description: (answers.description as string) || 'Iframe embed SDK',
    author: (answers.author as string) || '',
    includeReact: answers.includeReact as boolean,
    includeExample: answers.includeExample as boolean,
    outDir: path.resolve(process.cwd(), name),
  };
}
