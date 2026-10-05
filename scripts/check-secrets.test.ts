import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  decodeText,
  findSecretsInText,
  isAllowedEnvFile,
  isEnvFile,
  jwtRole,
  mask,
  scanRepository,
  SECRET_PATTERNS,
} from './check-secrets.mjs';

/**
 * Los valores de prueba se arman en tiempo de ejecución a propósito: si se
 * escribieran literales, este mismo archivo sería un hallazgo del escáner y el
 * CI quedaría rojo por el test que verifica al escáner.
 */
const PAT = `sbp_${'a1b2c3d4'.repeat(5)}`; // 40 hex
const SUPABASE_SECRET = `sb_secret_${'Ab1'.repeat(10)}`;
const RESEND_KEY = `re_${'A1b2C3d4'.repeat(4)}`;
const GITHUB_TOKEN = `ghp_${'Ab1Cc2Dd3'.repeat(4)}`; // 36 alfanuméricos
const GITHUB_FINE_TOKEN = `github_pat_${'aB1_'.repeat(15)}`;
const STRIPE_SECRET = `sk_live_${'Ab1cD2eF'.repeat(3)}`; // 24 alfanuméricos
const GOOGLE_API_KEY = `AIza${'aB1_-'.repeat(7)}`; // 35 caracteres
const SENTRY_TOKEN = `sntrys_${'Ab1_'.repeat(7)}`;
// La cabecera PEM se arma al vuelo: escrita entera en el fuente, este test
// sería un hallazgo del propio escáner.
const PEM_HEADER = ['-----BEGIN', 'RSA', 'PRIVATE', 'KEY-----'].join(' ');

function base64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

const SERVICE_ROLE_JWT = [
  base64url({ alg: 'HS256', typ: 'JWT' }),
  base64url({ iss: 'supabase', role: 'service_role', ref: 'wcxpkfmevrbjrjlbayba' }),
  'firma-de-prueba-no-real',
].join('.');

const ANON_JWT = [
  base64url({ alg: 'HS256', typ: 'JWT' }),
  base64url({ iss: 'supabase', role: 'anon', ref: 'wcxpkfmevrbjrjlbayba' }),
  'firma-de-prueba-no-real',
].join('.');

describe('findSecretsInText', () => {
  it('detecta el token personal de Supabase (sbp_)', () => {
    const findings = findSecretsInText(`SUPABASE_ACCESS_TOKEN=${PAT}`);
    expect(findings.some((f) => f.id === 'supabase-pat')).toBe(true);
  });

  it('detecta la clave secreta de Supabase (sb_secret_)', () => {
    const findings = findSecretsInText(`SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SECRET}`);
    expect(findings.some((f) => f.id === 'supabase-secret')).toBe(true);
  });

  it('detecta la clave de Resend (re_)', () => {
    const findings = findSecretsInText(`RESEND_API_KEY=${RESEND_KEY}`);
    expect(findings.some((f) => f.id === 'resend-key')).toBe(true);
  });

  it('detecta los tokens de GitHub clásicos (ghp_)', () => {
    const findings = findSecretsInText(`token = "${GITHUB_TOKEN}"`);
    expect(findings.some((f) => f.id === 'github-token')).toBe(true);
  });

  it('detecta los tokens finos de GitHub (github_pat_)', () => {
    const findings = findSecretsInText(`token = "${GITHUB_FINE_TOKEN}"`);
    expect(findings.some((f) => f.id === 'github-fine-grained-token')).toBe(true);
  });

  it('detecta la clave secreta de Stripe (sk_live_)', () => {
    const findings = findSecretsInText(`STRIPE_SECRET_KEY=${STRIPE_SECRET}`);
    expect(findings.some((f) => f.id === 'stripe-secret-key')).toBe(true);
  });

  it('detecta la clave de API de Google (AIza…)', () => {
    const findings = findSecretsInText(`GOOGLE_API_KEY=${GOOGLE_API_KEY}`);
    expect(findings.some((f) => f.id === 'google-api-key')).toBe(true);
  });

  it('detecta el token de Sentry (sntrys_)', () => {
    const findings = findSecretsInText(`SENTRY_AUTH_TOKEN=${SENTRY_TOKEN}`);
    expect(findings.some((f) => f.id === 'sentry-token')).toBe(true);
  });

  it('detecta un bloque de clave privada PEM', () => {
    const text = `${PEM_HEADER}\nMIIEogIBAAKCAQEA…\n-----END RSA PRIVATE KEY-----`;
    const findings = findSecretsInText(text);
    expect(findings.some((f) => f.id === 'private-key-block')).toBe(true);
  });

  it('no marca una clave publicable de Stripe (pk_)', () => {
    const findings = findSecretsInText(`NEXT_PUBLIC_STRIPE=${`pk_live_${'Ab1cD2eF'.repeat(3)}`}`);
    expect(findings).toEqual([]);
  });

  it('no marca una clave pública PEM ni los marcadores nuevos', () => {
    const text = [
      '-----BEGIN PUBLIC KEY-----',
      '-----BEGIN CERTIFICATE-----',
      '# GITHUB_TOKEN=ghp_tu_token',
      '# STRIPE_SECRET_KEY=sk_live_tu_clave',
      '# GOOGLE_API_KEY=AIza_tu_clave',
      '# SENTRY_AUTH_TOKEN=sntrys_tu_token',
    ].join('\n');
    expect(findSecretsInText(text)).toEqual([]);
  });

  it('detecta un JWT service_role', () => {
    const findings = findSecretsInText(`const key = "${SERVICE_ROLE_JWT}";`);
    expect(findings.some((f) => f.id === 'supabase-service-role-jwt')).toBe(true);
  });

  it('no marca una clave anónima: es pública', () => {
    const findings = findSecretsInText(`const key = "${ANON_JWT}";`);
    expect(findings).toEqual([]);
  });

  it('no marca los marcadores de .env.example ni de los docs', () => {
    const text = [
      '# SUPABASE_ACCESS_TOKEN=sbp_tu_token',
      '# RESEND_API_KEY=re_tu_clave',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY=tu-clave-anon-publica-aqui',
      'Supabase las retiró: ahora son publishable (`sb_publishable_…`) y secret (`sb_secret_…`).',
      'revocar `sbp_...` en el dashboard',
    ].join('\n');
    expect(findSecretsInText(text)).toEqual([]);
  });

  it('no confunde palabras que contienen «re_» (share_views, fire_station)', () => {
    const text = [
      "await supabase.rpc('increment_share_view', {});",
      "if (tags.amenity === 'fire_station') return 'safety';",
      'const key = process.env.SUPABASE_SERVICE_ROLE_KEY;',
    ].join('\n');
    expect(findSecretsInText(text)).toEqual([]);
  });

  it('informa la línea y la columna del hallazgo', () => {
    const findings = findSecretsInText(`linea uno\nRESEND_API_KEY=${RESEND_KEY}\n`);
    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(2);
    expect(findings[0].column).toBe('RESEND_API_KEY='.length + 1);
  });

  it('nunca devuelve el secreto entero', () => {
    const [finding] = findSecretsInText(`x=${RESEND_KEY}`);
    expect(finding.masked).not.toContain(RESEND_KEY);
    expect(finding.masked).toContain('caracteres');
  });
});

describe('jwtRole', () => {
  it('lee el rol del payload', () => {
    expect(jwtRole(SERVICE_ROLE_JWT)).toBe('service_role');
    expect(jwtRole(ANON_JWT)).toBe('anon');
  });

  it('devuelve null si no es un JWT legible', () => {
    expect(jwtRole('no-es-un-jwt')).toBeNull();
    expect(jwtRole('eyJhbGciOiJIUzI1NiJ9.no-es-base64-json.firma')).toBeNull();
  });
});

describe('reglas de archivos .env', () => {
  it('permite solo la plantilla .env.example', () => {
    expect(isAllowedEnvFile('.env.example')).toBe(true);
    expect(isAllowedEnvFile('.env.example.produccion')).toBe(true);
    expect(isAllowedEnvFile('.env.local')).toBe(false);
    expect(isAllowedEnvFile('.env')).toBe(false);
    expect(isAllowedEnvFile('docs.env.md')).toBe(false);
  });

  it('reconoce los nombres .env*', () => {
    expect(isEnvFile('.env')).toBe(true);
    expect(isEnvFile('.env.local')).toBe(true);
    expect(isEnvFile('.envelope')).toBe(false);
    expect(isEnvFile('env.local')).toBe(false);
  });
});

describe('scanRepository', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function makeTree(files: Record<string, string>): string {
    const root = mkdtempSync(path.join(os.tmpdir(), 'rix7-secrets-'));
    dirs.push(root);
    for (const [name, content] of Object.entries(files)) {
      const full = path.join(root, name);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
    return root;
  }

  it('marca un .env* versionado que no es la plantilla', () => {
    const root = makeTree({ '.env.local': 'X=1\n', '.env.example': 'X=tu-valor\n' });
    const result = scanRepository(root, ['.env.local', '.env.example']);
    expect(result.envFiles).toEqual(['.env.local']);
    expect(result.reports).toEqual([]);
  });

  it('detecta el secreto dentro de un archivo común', () => {
    const root = makeTree({ 'src/config.ts': `export const k = "${PAT}";\n` });
    const { reports } = scanRepository(root, ['src/config.ts']);
    expect(reports).toHaveLength(1);
    expect(reports[0].file).toBe('src/config.ts');
    expect(reports[0].findings[0].line).toBe(1);
  });

  it('ignora un binario aunque lo haya arrastrado git', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'rix7-secrets-'));
    dirs.push(root);
    writeFileSync(
      path.join(root, 'blob.bin'),
      Buffer.concat([Buffer.from([0x00, 0x01, 0x02]), Buffer.from(PAT)])
    );
    const { reports, skipped } = scanRepository(root, ['blob.bin']);
    expect(reports).toEqual([]);
    expect(skipped).toContain('blob.bin');
  });

  it('revisa un archivo UTF-16 en vez de descartarlo por binario', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'rix7-secrets-'));
    dirs.push(root);
    const text = `RESEND_API_KEY=${RESEND_KEY}\n`;
    writeFileSync(
      path.join(root, 'informe.txt'),
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])
    );
    const { reports, skipped } = scanRepository(root, ['informe.txt']);
    expect(skipped).toEqual([]);
    expect(reports).toHaveLength(1);
    expect(reports[0].findings.some((f) => f.id === 'resend-key')).toBe(true);
  });

  it('no explota si el archivo desapareció entre listar y leer', () => {
    const root = makeTree({ 'a.txt': 'ok\n' });
    const { reports } = scanRepository(root, ['no-existe.txt']);
    expect(reports).toEqual([]);
  });
});

describe('decodeText', () => {
  it('lee UTF-16LE con BOM', () => {
    const text = `RESEND_API_KEY=${RESEND_KEY}\n`;
    const buffer = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
    expect(decodeText(buffer)?.text).toBe(text);
  });

  it('lee UTF-16BE con BOM', () => {
    const text = 'hola\n';
    const le = Buffer.from(text, 'utf16le');
    const be = Buffer.from(le);
    be.swap16();
    const buffer = Buffer.concat([Buffer.from([0xfe, 0xff]), be]);
    expect(decodeText(buffer)?.text).toBe(text);
  });

  it('descarta un binario', () => {
    expect(decodeText(Buffer.from([0x00, 0x01, 0x02]))).toBeNull();
  });

  it('lee UTF-8 y quita el BOM', () => {
    const buffer = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('ok\n', 'utf8')]);
    expect(decodeText(buffer)?.text).toBe('ok\n');
  });
});

describe('mask', () => {
  it('recorta dejando ver el largo', () => {
    const masked = mask('sbp_1234567890abcdef');
    expect(masked.startsWith('sbp_123')).toBe(true);
    expect(masked).toContain('caracteres');
  });

  it('no filtra nada de un valor corto', () => {
    expect(mask('re_123')).not.toContain('re_');
  });
});

describe('SECRET_PATTERNS', () => {
  it('define patrones con id y etiqueta', () => {
    for (const pattern of SECRET_PATTERNS) {
      expect(pattern.id).toBeTruthy();
      expect(pattern.label).toBeTruthy();
      expect(pattern.regex).toBeInstanceOf(RegExp);
    }
  });
});

// Invariante de cableado, igual que las que guarda `next-paths.test.ts`: que la
// guardia no se caiga del paso previo de dev ni de deploy sin que nadie lo note.
describe('paso previo en los wrappers', () => {
  for (const wrapper of ['dev.mjs', 'deploy-prod.mjs'] as const) {
    it(`${wrapper} importa y usa assertNoSecrets`, () => {
      const source = readFileSync(new URL(`./${wrapper}`, import.meta.url), 'utf8');
      expect(source).toContain("import { assertNoSecrets } from './check-secrets.mjs'");
      expect(source).toContain('assertNoSecrets({');
    });
  }
});
