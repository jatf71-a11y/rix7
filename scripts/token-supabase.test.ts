/**
 * Tests del guardador del token de Supabase.
 *
 * Importa lo que no puede fallar en silencio: que el token **no** reemplace al
 * resto de `.env.local` (el error que tuvo la versión manual, que escribía con
 * `>`), que no duplique la variable si se corre dos veces, y que el valor nunca
 * aparezca en lo que el script imprime.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import {
  ENV_FILE,
  isPlausibleSecret,
  isPlausibleToken,
  nextSteps,
  projectLine,
  saveToken,
  SECRET_RULES,
  successMessage,
  TOKEN_VAR,
  upsertEnvVar,
} from './token-supabase.mjs';

/** Un token con la forma real (40 hex), armado en el test y no en el repo. */
const token = `sbp_${'a1b2c3d4'.repeat(5)}`;

const sandbox = mkdtempSync(path.join(os.tmpdir(), 'rix7-token-'));

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('isPlausibleToken', () => {
  it('acepta un token personal de Supabase', () => {
    expect(isPlausibleToken(token)).toBe(true);
  });

  it('rechaza lo que se pega por error', () => {
    // La anon key y la service role key son JWT: el error más probable.
    expect(isPlausibleToken('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.x')).toBe(false);
    expect(isPlausibleToken('')).toBe(false);
    expect(isPlausibleToken('sbp_')).toBe(false);
    expect(isPlausibleToken('sbp_corto')).toBe(false);
    expect(isPlausibleToken('pk_12345678901234567890')).toBe(false);
    expect(isPlausibleToken(undefined)).toBe(false);
    expect(isPlausibleToken(12345)).toBe(false);
  });

  it('acepta espacios alrededor: la consola agrega el salto de línea', () => {
    expect(isPlausibleToken(`  ${token}\n`)).toBe(true);
  });
});

describe('projectLine', () => {
  it('nombra el proyecto del .env.local para poder cotejar la cuenta del token', () => {
    const line = projectLine(
      'NEXT_PUBLIC_SUPABASE_URL=https://vsqkjimpssdvlvdwrtnh.supabase.co\nNEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ.falsa.firma\n'
    );

    // Es el error real que este aviso ataja: un token válido de otra cuenta no
    // ve este proyecto, y `db:push` falla sin decir por qué.
    expect(line).toContain('vsqkjimpssdvlvdwrtnh');
    expect(line).toContain('cuenta dueña de ese proyecto');
  });

  it('también sirve con el proyecto viejo: no está atado a una ref', () => {
    expect(projectLine('NEXT_PUBLIC_SUPABASE_URL=https://wcxpkfmevrbjrjlbayba.supabase.co\n')).toContain(
      'wcxpkfmevrbjrjlbayba'
    );
  });

  it('no imprime ningún secreto: solo la URL pública que ya está en el repo', () => {
    const line = projectLine(
      `SUPABASE_ACCESS_TOKEN=${token}\nNEXT_PUBLIC_SUPABASE_URL=https://vsqkjimpssdvlvdwrtnh.supabase.co\n`
    );

    expect(line).not.toContain(token);
    expect(line).not.toContain('sbp_');
    expect(line).not.toContain('eyJ');
  });

  it('tolera comillas y espacios alrededor del valor', () => {
    expect(projectLine('NEXT_PUBLIC_SUPABASE_URL="https://vsqkjimpssdvlvdwrtnh.supabase.co"\n')).toContain(
      'vsqkjimpssdvlvdwrtnh'
    );
    expect(projectLine('  NEXT_PUBLIC_SUPABASE_URL=  https://abc1234567.supabase.co  \n')).toContain(
      'abc1234567'
    );
  });

  it('si no hay URL no inventa un proyecto: devuelve null', () => {
    expect(projectLine('A=1\n')).toBeNull();
    expect(projectLine('')).toBeNull();
    expect(projectLine(undefined)).toBeNull();
    expect(projectLine('NEXT_PUBLIC_SUPABASE_URL=\n')).toBeNull();
  });

  it('con una URL que no es de Supabase igual la muestra, sin ref', () => {
    const line = projectLine('NEXT_PUBLIC_SUPABASE_URL=http://localhost:8000\n');

    expect(line).toContain('http://localhost:8000');
    expect(line).toContain('cuenta dueña');
  });
});

describe('upsertEnvVar', () => {
  it('agrega la variable al final sin tocar las demás', () => {
    const before = 'NEXT_PUBLIC_SUPABASE_URL=https://ejemplo.supabase.co\nNEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ.falsa.firma\n';
    const after = upsertEnvVar(before, TOKEN_VAR, token);

    expect(after).toContain('NEXT_PUBLIC_SUPABASE_URL=https://ejemplo.supabase.co');
    expect(after).toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ.falsa.firma');
    expect(after.endsWith(`${TOKEN_VAR}=${token}\n`)).toBe(true);
    // Las tres variables siguen ahí: es exactamente lo que el `>` destruía.
    expect(after.split('\n').filter(Boolean)).toHaveLength(3);
  });

  it('reemplaza en su lugar y no duplica la variable', () => {
    const before = `A=1\n${TOKEN_VAR}=viejo\nB=2\n`;
    const after = upsertEnvVar(before, TOKEN_VAR, token);

    expect(after).toBe(`A=1\n${TOKEN_VAR}=${token}\nB=2\n`);
    expect(after.match(new RegExp(`${TOKEN_VAR}=`, 'g'))).toHaveLength(1);
  });

  it('es idempotente: correrlo dos veces deja el mismo archivo', () => {
    const once = upsertEnvVar('A=1\n', TOKEN_VAR, token);
    expect(upsertEnvVar(once, TOKEN_VAR, token)).toBe(once);
  });

  it('funciona con un archivo vacío o sin salto final', () => {
    expect(upsertEnvVar('', TOKEN_VAR, token)).toBe(`${TOKEN_VAR}=${token}\n`);
    expect(upsertEnvVar('A=1', TOKEN_VAR, token)).toBe(`A=1\n${TOKEN_VAR}=${token}\n`);
  });

  it('no confunde un comentario que menciona la variable', () => {
    const before = `# ${TOKEN_VAR}=ejemplo-de-comentario\nA=1\n`;
    const after = upsertEnvVar(before, TOKEN_VAR, token);

    expect(after).toContain('# SUPABASE_ACCESS_TOKEN=ejemplo-de-comentario');
    expect(after.endsWith(`${TOKEN_VAR}=${token}\n`)).toBe(true);
  });
});

describe('saveToken', () => {
  it('escribe el archivo real y conserva lo que ya estaba', () => {
    const file = path.join(sandbox, 'env-1.local');
    writeFileSync(file, 'NEXT_PUBLIC_SUPABASE_URL=https://ejemplo.supabase.co\nVERCEL_OIDC_TOKEN=falso\n');

    const result = saveToken({ file, token });

    expect(result).toEqual({ file, name: TOKEN_VAR, length: token.length, replaced: false });
    const written = readFileSync(file, 'utf8');
    expect(written).toContain('NEXT_PUBLIC_SUPABASE_URL=https://ejemplo.supabase.co');
    expect(written).toContain('VERCEL_OIDC_TOKEN=falso');
    expect(written).toContain(`${TOKEN_VAR}=${token}`);
  });

  it('informa "actualizado" cuando la variable ya existía', () => {
    const file = path.join(sandbox, 'env-2.local');
    writeFileSync(file, `${TOKEN_VAR}=antiguo\nA=1\n`);

    expect(saveToken({ file, token }).replaced).toBe(true);
    expect(readFileSync(file, 'utf8').match(/sbp_/g)).toHaveLength(1);
  });

  it('crea el archivo si no existe', () => {
    const file = path.join(sandbox, 'no-existe.local');
    expect(saveToken({ file, token }).replaced).toBe(false);
    expect(readFileSync(file, 'utf8')).toBe(`${TOKEN_VAR}=${token}\n`);
  });

  it('lo que se imprime no contiene el token', () => {
    const message = successMessage({ length: token.length, replaced: false, file: ENV_FILE });

    expect(message).not.toContain(token);
    expect(message).not.toContain('sbp_');
    expect(message).toContain(String(token.length));
  });

  it('guarda otra variable si se le pide, sin tocar el token', () => {
    const file = path.join(sandbox, 'env-3.local');
    writeFileSync(file, `${TOKEN_VAR}=${token}\nA=1\n`);

    const service = `eyJhbGciOiJIUzI1NiJ9.${'b2N1cGE'.repeat(3)}.${'firma'.repeat(4)}`;
    const result = saveToken({ file, name: 'SUPABASE_SERVICE_ROLE_KEY', token: service });

    expect(result).toEqual({ file, name: 'SUPABASE_SERVICE_ROLE_KEY', length: service.length, replaced: false });
    const written = readFileSync(file, 'utf8');
    expect(written).toContain('SUPABASE_SERVICE_ROLE_KEY=');
    expect(written).toContain(`${TOKEN_VAR}=${token}`);
  });
});

describe('isPlausibleSecret', () => {
  const service = () => `eyJhbGciOiJIUzI1NiJ9.${'b2N1cGE'.repeat(3)}.${'firma'.repeat(4)}`;

  it('acepta el token personal y la clave de servicio, cada uno en su nombre', () => {
    expect(isPlausibleSecret(TOKEN_VAR, token).ok).toBe(true);
    expect(isPlausibleSecret('SUPABASE_SERVICE_ROLE_KEY', service()).ok).toBe(true);
    expect(
      isPlausibleSecret('SUPABASE_SERVICE_ROLE_KEY', `sb_${'secret'}_${'a'.repeat(24)}`).ok
    ).toBe(true);
  });

  it('ataja el error caro: la clave de servicio pegada donde va el token', () => {
    const verdict = isPlausibleSecret(TOKEN_VAR, service());
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.hint).toMatch(/sbp_/);
  });

  it('y la anon key pegada donde va la clave de servicio', () => {
    const anon = `eyJhbGciOiJIUzI1NiJ9.${'YW5vbg'.repeat(3)}.${'firma'.repeat(4)}`;
    // Con forma de JWT pasa la validación a propósito: distinguir anon de
    // service_role por el cuerpo del token sería adivinar. Lo que sí se ataja es
    // el vacío y la clave con otro prefijo.
    expect(isPlausibleSecret('SUPABASE_SERVICE_ROLE_KEY', anon).ok).toBe(true);
    expect(isPlausibleSecret('SUPABASE_SERVICE_ROLE_KEY', 'sb_publishable_lo-que-sea').ok).toBe(false);
    expect(isPlausibleSecret('SUPABASE_SERVICE_ROLE_KEY', '').ok).toBe(false);
  });

  it('una variable que no conoce solo tiene que venir con algo', () => {
    expect(isPlausibleSecret('ALERTS_CRON_SECRET', 'lo-que-sea').ok).toBe(true);
    expect(isPlausibleSecret('ALERTS_CRON_SECRET', '   ').ok).toBe(false);
  });

  it('las dos claves que sabe recibir están declaradas, con su pista', () => {
    expect(Object.keys(SECRET_RULES)).toEqual([TOKEN_VAR, 'SUPABASE_SERVICE_ROLE_KEY']);
    expect(SECRET_RULES.SUPABASE_SERVICE_ROLE_KEY.alias).toMatch(/solo servidor/);
  });
});

describe('nextSteps', () => {
  it('al token le sigue el estado de las migraciones', () => {
    expect(nextSteps(TOKEN_VAR).join('\n')).toContain('npm run db:status');
  });

  it('a la clave de servicio le sigue el corte de Vercel, en ese orden', () => {
    const steps = nextSteps('SUPABASE_SERVICE_ROLE_KEY').join('\n');
    // Primero el comando único (preflight + Vercel + deploy); el paso a paso queda
    // detrás como alternativa, y mantiene su orden: nada se publica sin aplicar
    // antes las variables.
    expect(steps.indexOf('corte:supabase')).toBeLessThan(steps.indexOf('vercel:sync -- --dry-run'));
    expect(steps.indexOf('vercel:sync -- --dry-run')).toBeLessThan(steps.indexOf('deploy:prod'));
    expect(steps.indexOf('vercel:sync               ')).toBeLessThan(steps.indexOf('deploy:prod'));
  });

  it('a una credencial de servidor le sigue publicarla en Vercel y desplegar', () => {
    const steps = nextSteps('EXA_API_KEY').join('\n');
    // Guardarla no es publicarla: Vercel la fija al desplegar, y sin ese deploy
    // el runtime sigue en simulación sin avisar.
    expect(steps).toContain('vercel:sync -- --only EXA_API_KEY');
    expect(steps).toContain('npm run deploy');
    expect(steps.indexOf('vercel:sync')).toBeLessThan(steps.indexOf('npm run deploy'));
  });

  it('no sugiere nada para una variable que no conoce', () => {
    expect(nextSteps('OTRA_COSA')).toEqual([]);
  });
});
