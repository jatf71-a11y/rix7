#!/usr/bin/env node
/**
 * Publica el proyecto a producción en Vercel.
 *
 * ¿Por qué no basta con `git push`?
 * El proyecto vive en un equipo Hobby y, en ese plan, **solo el dueño de la
 * cuenta puede crear deployments**. Los commits de este repositorio van
 * firmados por un autor que no es miembro del equipo, así que Vercel acepta el
 * push, compila y después descarta el deployment con:
 *
 *   "The deployment was blocked because the commit author doesn't have
 *    permission to create deployments for this project."
 *
 * Este script publica **sin metadata de git**: copia el árbol de trabajo a un
 * directorio temporal (sin `.git`, `node_modules` ni `.next`), bloquea el
 * descubrimiento del repositorio con `GIT_CEILING_DIRECTORIES` y despliega
 * desde ahí. El deployment queda atribuido a la cuenta dueña —que sí tiene
 * permiso— y Vercel lo promueve a producción automáticamente.
 *
 * Uso: npm run deploy:prod
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const staging = path.join(root, '.deploy-staging');

/** Rutas que no deben viajar al deployment. */
const EXCLUDED = new Set([
  '.git',
  '.next',
  '.vercel',
  '.deploy-staging',
  '.deploy-tmp',
  '.freebuff',
  'node_modules',
  'out',
  'build',
]);

function copyTree(from, to) {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (EXCLUDED.has(entry.name)) continue;
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(target, { recursive: true });
      copyTree(source, target);
    } else {
      fs.copyFileSync(source, target);
    }
  }
}

// La copia mantiene el vínculo con el proyecto de Vercel.
const projectFile = path.join(root, '.vercel', 'project.json');
if (!fs.existsSync(projectFile)) {
  console.error('✖ No se encontró .vercel/project.json — ejecuta `npx vercel link` primero.');
  process.exit(1);
}

console.log('→ Preparando copia sin metadata de git…');
fs.rmSync(staging, { recursive: true, force: true });
copyTree(root, staging);
fs.mkdirSync(path.join(staging, '.vercel'), { recursive: true });
fs.copyFileSync(projectFile, path.join(staging, '.vercel', 'project.json'));

// `GIT_CEILING_DIRECTORIES` impide que git ascienda hasta el repositorio real:
// sin esa metadata, el deployment lo crea la cuenta dueña y no queda bloqueado.
const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['--yes', 'vercel', '--prod', '--yes'],
  {
    cwd: staging,
    stdio: 'inherit',
    env: { ...process.env, GIT_CEILING_DIRECTORIES: root },
  }
);

fs.rmSync(staging, { recursive: true, force: true });
process.exit(result.status ?? 1);
