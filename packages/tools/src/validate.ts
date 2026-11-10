#!/usr/bin/env node
// Usage: campo-validate [campusesDir]   (default: <repo>/data/campuses)
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runValidate } from './cli.ts';

const defaultDir = fileURLToPath(new URL('../../../data/campuses', import.meta.url));
// npm runs workspace scripts inside the package folder; INIT_CWD is where the user typed the command.
const cwd = process.env['INIT_CWD'] ?? process.cwd();
const arg = process.argv[2];
const dir = arg ? resolve(cwd, arg) : defaultDir;

process.exitCode = await runValidate(dir, console, cwd);
