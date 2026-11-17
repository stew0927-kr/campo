#!/usr/bin/env node
// Usage: campo-apply <changeset.json...> [--dry-run] [--campuses-dir=<folder>]
// The campus folder is {campuses dir}/{changeset campus}. The campuses dir is --campuses-dir, else CAMPO_CAMPUSES_DIR
// (the same variable the editor's save API reads), else <repo>/data/campuses.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runApply } from './apply-cli.ts';

const defaultDir = fileURLToPath(new URL('../../../data/campuses', import.meta.url));
// npm runs workspace scripts inside the package folder; INIT_CWD is where the user typed the command.
const cwd = process.env['INIT_CWD'] ?? process.cwd();
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const dirFlag = args.find((a) => a.startsWith('--campuses-dir='))?.slice('--campuses-dir='.length);
const envDir = process.env['CAMPO_CAMPUSES_DIR'];
const campusesDir = dirFlag ? resolve(cwd, dirFlag) : envDir ? resolve(cwd, envDir) : defaultDir;
const files = args.filter((a) => !a.startsWith('--'));

process.exitCode = await runApply(files, { dryRun, campusesDir, now: new Date() }, console, cwd);
