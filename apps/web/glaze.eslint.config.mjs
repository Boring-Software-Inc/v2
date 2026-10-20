// Glaze's lint. Run it from the project root:
//   npx eslint -c glaze.eslint.config.mjs .
// It flags what Glaze's rules forbid in app code (two primary buttons in one group, glass on something nobody presses, a
// shadow, mono at the sans size, raw colors, classes Glaze's theme lacks, native controls ...) and each message says
// what to use instead. Glaze's own components (components/glaze/ui, components/glaze/ai, components/glaze/icon.tsx and
// lib/glaze) are held to the rules that apply to them; its blocks in
// components/glaze/blocks are screens the app owns, so they get the app rules.
//
// Already have an eslint.config? Add Glaze to it instead:
//   import glaze from './glaze.eslint.config.mjs';
//   export default [...yourConfig, ...glaze];
import {existsSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import tsParser from '@typescript-eslint/parser';

/** The plugin: beside this file, or in the lib folder shadcn put it in (lib/glaze/lint, src/lib/glaze/lint, or the components.json lib alias). */
function pluginPath() {
  const here = dirname(fileURLToPath(import.meta.url));
  const dirs = [here, join(here, 'lib/glaze/lint'), join(here, 'src/lib/glaze/lint')];
  try {
    const alias = JSON.parse(readFileSync(join(here, 'components.json'), 'utf8')).aliases?.lib;
    if (alias) dirs.push(...['', 'src'].map(base => join(here, base, alias.replace(/^[@~]\//, ''), 'glaze/lint')));
  } catch {}
  const found = dirs.map(dir => join(dir, 'plugin.mjs')).find(existsSync);
  if (!found) throw new Error('Glaze lint: lib/glaze/lint/plugin.mjs is missing. Run npx shadcn@latest add https://design.how/r/glaze/lint.json');
  return found;
}

const plugin = pluginPath();
const glaze = (await import(pathToFileURL(plugin).href)).default;
// The paths every system's lint skips (build output, shadcn's own components/ui), from the shared file beside the plugin.
const {LINT_IGNORES} = await import(pathToFileURL(join(dirname(plugin), 'value-rules.mjs')).href);

export default [
  {ignores: [...LINT_IGNORES, '**/lib/glaze/lint/**']},
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    languageOptions: {parser: tsParser, parserOptions: {ecmaFeatures: {jsx: true}}},
    linterOptions: {reportUnusedDisableDirectives: 'off'},
    plugins: {glaze},
    processor: 'glaze/standalone',
    rules: glaze.configs.app.rules,
  },
  {files: ['**/components/glaze/{ui,ai}/**', '**/components/glaze/icon.tsx', '**/lib/glaze/**'], rules: glaze.configs.source.rules},
];
