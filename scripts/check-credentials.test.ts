import { describe, expect, it } from 'vitest';

import {
  CREDENTIALS,
  EXPECTED_VERCEL_PROJECT_ID,
  OWNER_ACCOUNT_EMAIL,
  OWNER_PROJECT_REF,
  auditCredentials,
  cutReadiness,
  exitCodeFor,
  formatReport,
  jwtRef,
  missingRequirements,
  probeResend,
  readLocalFacts,
  readValues,
} from './check-credentials.mjs';

// La duplicación de estos datos es deliberada —`lib/utils/supabaseOwner` es
// TypeScript y lo usa el runtime del portal; acá hay una sonda de Node— y por eso
// se coteja, igual que en `check-account.test.ts`: así no puede quedarse callada.
import {
  DEFAULT_OWNER_PROJECT_REF,
  OWNER_ACCOUNT_EMAIL as APP_OWNER_ACCOUNT_EMAIL,
} from '../lib/utils/supabaseOwner';
import { EXPECTED_VERCEL_PROJECT } from './corte-supabase.mjs';

/**
 * Los valores de prueba se arman al vuelo, nunca escritos enteros en el fuente: la
 * guardia de secretos (`npm run check:secrets`) corre antes de cada commit y un
 * literal con forma de clave real sería un hallazgo de ella. Es la misma regla que
 * sigue `check-secrets.test.ts`.
 */
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

const REF_A = 'vsqkjimpssdvlvdwrtnh';
const REF_B = 'wcxpkfmevrbjrjlbayba';

function jwtRefValue(ref: string, role = 'anon'): string {
  return [b64({ alg: 'HS256', typ: 'JWT' }), b64({ iss: 'supabase', role, ref }), 'firma-de-prueba'].join('.');
}

const ANON_A = jwtRefValue(REF_A);
const SERVICE_A = jwtRefValue(REF_A, 'service_role');
const ANON_B = jwtRefValue(REF_B, 'anon');

const URL_A = `https://${REF_A}.supabase.co`;
const PAT = `sbp_${'a1b2c3d4'.repeat(5)}`;
const SERVICE_NEW = `sb_secret_${'Xy9_'.repeat(8)}`;
const PUBLISHABLE_NEW = `sb_publishable_${'Qw8-'.repeat(6)}`;
const RESEND_KEY = `re_${'A1b2C3d4'.repeat(4)}`;

/** Los valores de un entorno que está todo bien y apunta al proyecto de la cuenta dueña. */
const HEALTHY = {
  NEXT_PUBLIC_SUPABASE_URL: URL_A,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_A,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_A,
  SUPABASE_ACCESS_TOKEN: PAT,
  RESEND_API_KEY: RESEND_KEY,
  ALERTS_FROM_EMAIL: 'Rix7 <avisos@rix7.cl>',
  SOLICITUDES_EMAIL_TO: 'equipo@rix7.cl',
  ALERTS_CRON_SECRET: 'a'.repeat(40),
  NEXT_PUBLIC_Sentry_DSN: undefined,
  NEXT_PUBLIC_SENTRY_DSN: 'https://abc123@o4507.ingest.sentry.io/4507',
  NEXT_PUBLIC_SITE_URL: 'https://rix7.cl',
  VERCEL_OIDC_TOKEN: 'token-de-prueba',
} as Record<string, string | undefined>;

/** Los hechos locales de una máquina enlazada y con respaldo. */
const FACTS_OK = {
  vercelProjectId: 'prj_38HRJ2h2Q8lxjsXu4pRU6MkRpMD4',
  backupFiles: ['.env.local.pre-migracion-2026-10-14'],
};

const byId = (findings: ReturnType<typeof auditCredentials>, id: string) => {
  const finding = findings.find((f) => f.id === id);
  if (!finding) throw new Error(`No hay credencial con id ${id}`);
  return finding;
};

describe('jwtRef', () => {
  it('lee la referencia del proyecto del cuerpo de una clave clásica', () => {
    expect(jwtRef(ANON_A)).toBe(REF_A);
    expect(jwtRef(SERVICE_A)).toBe(REF_A);
  });

  it('devuelve null con una clave nueva, que no lleva la referencia', () => {
    expect(jwtRef(SERVICE_NEW)).toBeNull();
    expect(jwtRef(PUBLISHABLE_NEW)).toBeNull();
  });

  it('devuelve null con lo que no es un JWT de tres partes', () => {
    expect(jwtRef(null)).toBeNull();
    expect(jwtRef('')).toBeNull();
    expect(jwtRef(URL_A)).toBeNull();
    expect(jwtRef('eyJ.cuerpo')).toBeNull();
  });

  it('no explota con un cuerpo que no es JSON', () => {
    expect(jwtRef('cabecera.no-es-json.firma')).toBeNull();
  });
});

describe('auditCredentials: entorno vacío', () => {
  const findings = auditCredentials({ values: {}, facts: {} });

  it('marca como faltantes todas las variables del catálogo', () => {
    for (const credential of CREDENTIALS) {
      expect(byId(findings, credential.id).state).toBe('missing');
    }
  });

  it('no deja pasar el corte y dice qué lo bloquea', () => {
    const { ready, blockedBy } = cutReadiness(findings);
    expect(ready).toBe(false);
    expect(blockedBy).toContain('Supabase: URL del proyecto');
    expect(blockedBy).toContain('Supabase: clave de servicio');
  });

  it('sale con 1 porque falta algo crítico', () => {
    expect(exitCodeFor(findings)).toBe(1);
    expect(missingRequirements(findings).length).toBeGreaterThan(0);
  });

  it('cada credencial dice dónde se consigue y cómo se guarda', () => {
    for (const finding of findings) {
      expect(finding.where.length).toBeGreaterThan(10);
      expect(finding.save.length).toBeGreaterThan(3);
      expect(finding.impact.length).toBeGreaterThan(10);
    }
  });
});

describe('auditCredentials: entorno completo', () => {
  const findings = auditCredentials({ values: HEALTHY, facts: FACTS_OK });

  it('deja el corte listo y sale con 0', () => {
    const { ready, blockedBy } = cutReadiness(findings);
    expect(blockedBy).toEqual([]);
    expect(ready).toBe(true);
    expect(exitCodeFor(findings)).toBe(0);
  });

  it('reconoce la URL del proyecto de la cuenta dueña', () => {
    const url = byId(findings, 'supabase_url');
    expect(url.state).toBe('ok');
    expect(url.detail).toContain(REF_A);
  });

  it('no cuenta como fallo lo que no se comprobó, pero lo informa', () => {
    const cli = byId(findings, 'vercel_cli');
    expect(cli.state).toBe('unchecked');
    expect(cli.notes.join(' ')).toContain('--online');
    expect(exitCodeFor(findings)).toBe(0);
  });
});

describe('auditCredentials: errores de copiar y pegar', () => {
  it('detecta el placeholder de desarrollo', () => {
    const findings = auditCredentials({ values: { NEXT_PUBLIC_SUPABASE_URL: 'https://placeholder.supabase.co' } });
    const url = byId(findings, 'supabase_url');
    expect(url.state).toBe('malformed');
    expect(url.problem).toContain('placeholder');
  });

  it('detecta una clave pública con forma rara', () => {
    const findings = auditCredentials({ values: { NEXT_PUBLIC_SUPABASE_ANON_KEY: 'no-es-una-clave' } });
    expect(byId(findings, 'supabase_anon_key').state).toBe('malformed');
  });

  it('detecta la clave pública del proyecto equivocado', () => {
    const findings = auditCredentials({
      values: { NEXT_PUBLIC_SUPABASE_URL: URL_A, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_B },
    });
    const anon = byId(findings, 'supabase_anon_key');
    expect(anon.state).toBe('mismatch');
    expect(anon.problem).toContain(REF_B);
    expect(anon.problem).toContain(REF_A);
  });

  it('detecta la clave de servicio del proyecto equivocado', () => {
    const findings = auditCredentials({
      values: { NEXT_PUBLIC_SUPABASE_URL: URL_A, SUPABASE_SERVICE_ROLE_KEY: jwtRefValue(REF_B, 'service_role') },
    });
    expect(byId(findings, 'supabase_service_role_key').state).toBe('mismatch');
  });

  it('acepta las claves nuevas y aclara que su proyecto no se coteja sin red', () => {
    const findings = auditCredentials({
      values: { NEXT_PUBLIC_SUPABASE_URL: URL_A, NEXT_PUBLIC_SUPABASE_ANON_KEY: PUBLISHABLE_NEW, SUPABASE_SERVICE_ROLE_KEY: SERVICE_NEW },
    });
    const anon = byId(findings, 'supabase_anon_key');
    const service = byId(findings, 'supabase_service_role_key');
    expect(anon.state).toBe('ok');
    expect(anon.notes.join(' ')).toContain('check:auth');
    expect(service.state).toBe('ok');
    expect(service.notes.join(' ')).toContain('sondea contra la base');
  });

  it('marca un token personal con forma de clave, en vez de aceptarlo', () => {
    const findings = auditCredentials({ values: { SUPABASE_ACCESS_TOKEN: ANON_A } });
    const token = byId(findings, 'supabase_access_token');
    expect(token.state).toBe('malformed');
    expect(String(token.problem)).toContain('sbp_');
  });

  it('marca una clave de servicio pegada en el lugar del token', () => {
    const findings = auditCredentials({ values: { SUPABASE_SERVICE_ROLE_KEY: 'esto-no-es-una-clave' } });
    expect(byId(findings, 'supabase_service_role_key').state).toBe('malformed');
  });
});

describe('auditCredentials: hechos fuera de las variables', () => {
  it('detecta el repo enlazado a otro proyecto de Vercel', () => {
    const findings = auditCredentials({ values: HEALTHY, facts: { vercelProjectId: 'prj_otro', backupFiles: [] } });
    const link = byId(findings, 'vercel_link');
    expect(link.state).toBe('mismatch');
    expect(cutReadiness(findings).ready).toBe(false);
  });

  it('informa que la CLI no tiene sesión cuando la sonda lo dice', () => {
    const findings = auditCredentials({
      values: HEALTHY,
      facts: {
        vercelSessionProblem: { ok: false, reason: 'failed', message: 'Error: Not authenticated' },
        backupFiles: [],
      },
    });
    const cli = byId(findings, 'vercel_cli');
    expect(cli.state).toBe('missing');
    expect(cli.notes.join(' ')).toContain('Not authenticated');
    expect(exitCodeFor(findings)).toBe(1);
  });

  it('no confunde «tardó demasiado» con «no hay sesión»', () => {
    const findings = auditCredentials({
      values: HEALTHY,
      facts: {
        vercelProjectId: 'prj_38HRJ2h2Q8lxjsXu4pRU6MkRpMD4',
        vercelSessionProblem: { ok: false, reason: 'timeout' },
        repoSecretsProblem: { ok: false, reason: 'unavailable', message: 'ENOENT' },
        backupFiles: [],
      },
    });

    for (const id of ['vercel_cli', 'repo_secrets']) {
      const finding = byId(findings, id);
      expect(finding.state).toBe('unchecked');
      expect(finding.notes.join(' ')).toContain('no se pudo comprobar');
    }

    // Un «no sé» no puede poner el comando en rojo: no se puede afirmar que falte.
    expect(exitCodeFor(findings)).toBe(0);
  });

  it('nombra los secretos que faltan en el repositorio', () => {
    const findings = auditCredentials({ values: HEALTHY, facts: { repoSecrets: ['ALERTS_CRON_SECRET'], backupFiles: [] } });
    const repo = byId(findings, 'repo_secrets');
    expect(repo.state).toBe('missing');
    expect(repo.detail).toContain('SUPABASE_ACCESS_TOKEN');
  });

  it('no falla por los opcionales que faltan', () => {
    const findings = auditCredentials({
      values: { ...HEALTHY, NEXT_PUBLIC_SITE_URL: undefined, NEXT_PUBLIC_SENTRY_DSN: undefined },
      facts: FACTS_OK,
    });
    expect(byId(findings, 'site_url').state).toBe('missing');
    expect(exitCodeFor(findings)).toBe(0);
  });

  it('avisa, sin marcarlo como fallo, si la URL canónica termina en barra', () => {
    const findings = auditCredentials({ values: { ...HEALTHY, NEXT_PUBLIC_SITE_URL: 'https://rix7.cl/' }, facts: FACTS_OK });
    const site = byId(findings, 'site_url');
    expect(site.state).toBe('ok');
    expect(site.notes.join(' ')).toContain('barra');
  });
});

describe('formatReport', () => {
  it('explica dónde conseguir lo que falta y con qué comando guardarlo', () => {
    const findings = auditCredentials({ values: {}, facts: {} });
    const report = formatReport({ findings });

    expect(report).toContain('Supabase: clave de servicio');
    expect(report).toContain('Project Settings » API Keys');
    expect(report).toContain('npm run env:secret');
    expect(report).toContain('supabase.com/dashboard/account/tokens');
    expect(report).toContain('gh secret set SUPABASE_ACCESS_TOKEN');
    expect(report).toContain('Para el corte de Supabase: ✗');
  });

  it('no imprime ningún valor: solo estados y formas', () => {
    const values = { ...HEALTHY, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_B };
    const report = formatReport({ findings: auditCredentials({ values, facts: FACTS_OK }) });

    for (const secret of [ANON_A, ANON_B, SERVICE_A, PAT, RESEND_KEY, HEALTHY.ALERTS_CRON_SECRET]) {
      expect(report).not.toContain(String(secret));
    }
  });

  it('dice que el corte está listo cuando lo está', () => {
    const report = formatReport({ findings: auditCredentials({ values: HEALTHY, facts: FACTS_OK }) });
    expect(report).toContain('Para el corte de Supabase: ✓');
    expect(report).toContain('no falta nada crítico ni degradado');
  });

  it('encamina a los comandos que sí miran la base', () => {
    const report = formatReport({ findings: auditCredentials({ values: HEALTHY, facts: FACTS_OK }) });
    for (const command of ['check:auth', 'check:schema', 'check:cuenta', 'check:health']) {
      expect(report).toContain(command);
    }
  });
});

describe('readValues', () => {
  const envFile = '/falso/.env.local';

  it('el entorno gana cuando trae algo, y el archivo cubre lo que no', () => {
    const values = readValues({
      env: { NEXT_PUBLIC_SUPABASE_URL: 'https://otro.supabase.co' },
      envFile,
      exists: () => true,
      read: () => `NEXT_PUBLIC_SUPABASE_URL=${URL_A}\nNEXT_PUBLIC_SITE_URL=https://rix7.cl\n`,
    });

    expect(values.NEXT_PUBLIC_SUPABASE_URL).toBe('https://otro.supabase.co');
    expect(values.NEXT_PUBLIC_SITE_URL).toBe('https://rix7.cl');
  });

  it('una variable vacía en el entorno no tapa el valor del archivo', () => {
    const values = readValues({
      env: { NEXT_PUBLIC_SITE_URL: '   ' },
      envFile,
      exists: () => true,
      read: () => 'NEXT_PUBLIC_SITE_URL=https://rix7.cl\n',
    });

    expect(values.NEXT_PUBLIC_SITE_URL).toBe('https://rix7.cl');
  });

  it('sin archivo quedan solo las del entorno', () => {
    const values = readValues({ env: { A: '1' }, envFile, exists: () => false });
    expect(values).toEqual({ A: '1' });
  });
});

describe('los datos duplicados coinciden con sus dueños', () => {
  it('el proyecto y la cuenta dueña son los del código de la app', () => {
    expect(OWNER_PROJECT_REF).toBe(DEFAULT_OWNER_PROJECT_REF);
    expect(OWNER_ACCOUNT_EMAIL).toBe(APP_OWNER_ACCOUNT_EMAIL);
  });

  it('el proyecto de Vercel es el mismo al que escribe el corte', () => {
    expect(EXPECTED_VERCEL_PROJECT_ID).toBe(EXPECTED_VERCEL_PROJECT.projectId);
  });
});

describe('la clave de Resend vencida no pasa como buena', () => {
  const invalid = { ok: false as const, reason: 'invalid' as const, status: 400, message: 'API key is invalid' };

  it('marca la credencial como vencida y sale en rojo', () => {
    const findings = auditCredentials({ values: HEALTHY, facts: { ...FACTS_OK, resendKey: invalid } });
    const resend = byId(findings, 'resend_api_key');

    expect(resend.state).toBe('stale');
    expect(resend.detail).toContain('vencida');
    expect(resend.problem).toContain('API key is invalid');
    expect(resend.notes.join(' ')).toContain('Emití una nueva');
    expect(missingRequirements(findings).some((f: { id: string }) => f.id === 'resend_api_key')).toBe(true);
    expect(exitCodeFor(findings)).toBe(1);
  });

  it('el informe lo dice y encamina a emitir otra', () => {
    const findings = auditCredentials({ values: HEALTHY, facts: { ...FACTS_OK, resendKey: invalid } });
    const report = formatReport({ findings });

    expect(report).toContain('vencida');
    expect(report).toContain('resend.com/api-keys');
  });

  it('con la clave aceptada queda en verde y lo dice', () => {
    const findings = auditCredentials({ values: HEALTHY, facts: { ...FACTS_OK, resendKey: { ok: true } } });

    expect(byId(findings, 'resend_api_key').state).toBe('ok');
    expect(byId(findings, 'resend_api_key').notes.join(' ')).toContain('aceptó');
    expect(exitCodeFor(findings)).toBe(0);
  });

  it('un fallo de red es «no se pudo comprobar», no una clave vencida', () => {
    const findings = auditCredentials({
      values: HEALTHY,
      facts: { ...FACTS_OK, resendKey: { ok: false, reason: 'unavailable', message: 'fetch failed' } },
    });
    const resend = byId(findings, 'resend_api_key');

    expect(resend.state).toBe('ok');
    expect(resend.notes.join(' ')).toContain('No se pudo comprobar');
    expect(exitCodeFor(findings)).toBe(0);
  });

  it('sin sonda no cambia nada: solo se afirma lo que se ve', () => {
    const findings = auditCredentials({ values: HEALTHY, facts: FACTS_OK });
    expect(byId(findings, 'resend_api_key').state).toBe('ok');
  });
});

describe('la clave que no se puede leer', () => {
  it('nombra el marcador de `vercel env pull` en vez de hablar del prefijo', () => {
    const findings = auditCredentials({ values: { ...HEALTHY, RESEND_API_KEY: '[SENSITIVE]' }, facts: FACTS_OK });
    const resend = byId(findings, 'resend_api_key');

    expect(resend.state).toBe('malformed');
    expect(resend.problem).toContain('[SENSITIVE]');
    expect(resend.problem).toContain('.env.local');
  });
});

describe('probeResend', () => {
  const respond = (status: number, body = '') => async () => new Response(body, { status });
  const asFetch = (impl: () => Promise<Response>) => impl as unknown as typeof fetch;

  it('acepta la clave cuando Resend contesta 200', async () => {
    expect(await probeResend({ key: RESEND_KEY, fetchImpl: asFetch(respond(200, '{"data":[]}')) })).toEqual({ ok: true });
  });

  it('Resend rechaza una clave vencida con 400, no con 401', async () => {
    const verdict = await probeResend({
      key: RESEND_KEY,
      fetchImpl: asFetch(respond(400, '{"statusCode":400,"message":"API key is invalid"}')),
    });

    expect(verdict).toMatchObject({ ok: false, reason: 'invalid', status: 400 });
    if (verdict && !verdict.ok) expect(verdict.message).toContain('API key is invalid');
  });

  it('un 5xx no acusa a la clave', async () => {
    const verdict = await probeResend({ key: RESEND_KEY, fetchImpl: asFetch(respond(503)) });
    expect(verdict).toMatchObject({ ok: false, reason: 'unavailable' });
  });

  it('sin clave no hay nada que preguntar', async () => {
    expect(await probeResend({ key: null })).toBeNull();
  });
});

describe('readLocalFacts', () => {
  it('lee el proyecto enlazado y los respaldos', () => {
    const facts = readLocalFacts({
      root: '/falso',
      exists: () => true,
      read: () => JSON.stringify({ projectId: 'prj_38HRJ2h2Q8lxjsXu4pRU6MkRpMD4' }),
      list: () => ['.env.local', '.env.local.pre-migracion-2026-10-14', '.env.local.pre-otro'],
    });

    expect(facts.vercelProjectId).toBe('prj_38HRJ2h2Q8lxjsXu4pRU6MkRpMD4');
    expect(facts.backupFiles).toEqual(['.env.local.pre-migracion-2026-10-14', '.env.local.pre-otro']);
  });

  it('no explota si el enlace no existe o no es JSON', () => {
    const missing = readLocalFacts({ root: '/falso', exists: () => false, list: () => [] });
    expect(missing.vercelProjectId).toBeNull();
    expect(missing.backupFiles).toEqual([]);

    const broken = readLocalFacts({ root: '/falso', exists: () => true, read: () => 'no-json', list: () => [] });
    expect(broken.vercelProjectId).toBeNull();
  });
});
