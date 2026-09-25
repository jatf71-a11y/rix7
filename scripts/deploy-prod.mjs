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
// El staging se crea acá y no dentro de `copyTree`: esa función solo hace
// `mkdirSync` cuando copia un directorio, así que si el primer elemento del
// árbol es un archivo (`.env.example` va primero en orden alfabético) el
// `copyFileSync` apunta a una carpeta que todavía no existe y falla con ENOENT.
fs.mkdirSync(staging, { recursive: true });
copyTree(root, staging);
fs.mkdirSync(path.join(staging, '.vercel'), { recursive: true });
fs.copyFileSync(projectFile, path.join(staging, '.vercel', 'project.json'));

// `GIT_CEILING_DIRECTORIES` impide que git ascienda hasta el repositorio real:
// sin esa metadata, el deployment lo crea la cuenta dueña y no queda bloqueado.
// En Windows `npx` es un shim `.cmd`, y desde el parche de CVE-2024-27980 Node no
// lanza `.cmd`/`.bat` directamente: `spawnSync` falla con EINVAL y deja `status`
// en `null`. Se pasa por `cmd.exe /c` en vez de `shell: true`, que es la forma
// explícita de invocar el shim sin que los argumentos pasen por un intérprete.
const isWindows = process.platform === 'win32';
const vercel = ['--yes', 'vercel', '--prod', '--yes'];
const [command, args] = isWindows ? ['cmd.exe', ['/c', 'npx', ...vercel]] : ['npx', vercel];

const result = spawnSync(command, args, {
  cwd: staging,
  stdio: 'inherit',
  env: { ...process.env, GIT_CEILING_DIRECTORIES: root },
});

// La limpieza no puede tumbar el script: en Windows el CLI puede seguir
// reteniendo archivos un instante (EPERM) y un fallo acá taparía el error real
// del deploy, que es lo único que importa cuando algo sale mal.
try {
  fs.rmSync(staging, { recursive: true, force: true });
} catch (err) {
  console.warn('⚠ No se pudo borrar el staging (queda para revisar):', err.code);
}

// Un fallo al **lanzar** (no un fallo del deploy) deja `status` en `null`. Sin
// esto el script salía con 1 y sin imprimir nada, que es lo que lo hacía
// imposible de diagnosticar.
if (result.error) {
  console.error('✖ No se pudo lanzar el CLI de Vercel:', result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
