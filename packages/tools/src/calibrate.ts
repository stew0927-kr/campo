#!/usr/bin/env node
// Usage: campo-calibrate [campusFolder...] [--dry-run]   (default: every campus under <repo>/data/campuses)
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCalibrate } from './calibrate-cli.ts';

const defaultDir = fileURLToPath(new URL('../../../data/campuses', import.meta.url));
// npm runs workspace scripts inside the package folder; INIT_CWD is where the user typed the command.
const cwd = process.env['INIT_CWD'] ?? process.cwd();
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const paths = args.filter((a) => !a.startsWith('--')).map((a) => resolve(cwd, a));

process.exitCode = await runCalibrate(paths.length > 0 ? paths : [defaultDir], { dryRun }, console, cwd);
