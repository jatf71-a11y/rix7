/**
 * Tests del verificador de la configuración del acceso.
 *
 * Lo que decide qué reportar es puro y está acá: leer el `.env`, juzgar las
 * credenciales e interpretar `/auth/v1/settings`. Un error en esto haría que el
 * script dijera "todo bien" con el placeholder puesto, que es exactamente el
 * problema que existe para detectar.
 */
import { describe, it, expect } from 'vitest';
import {
  BUILT_IN_EMAIL_LIMIT_PER_HOUR,
  authEndpoints,
  buildOtpPayload,
  classifyAnonKey,
  classifySupabaseUrl,
  inboxChecklist,
  readEnvContent,
  summarizeSettings,
} from './check-auth-config.mjs';

describe('readEnvContent', () => {
  it('lee claves, comillas y comentarios', () => {
    const env = readEnvContent(
      [
        '# comentario',
        'NEXT_PUBLIC_SUPABASE_URL=https://abc.supabase.co',
        'CON_COMILLAS="valor con espacios"',
        "SIMPLES='otro valor'",
        'CON_COMENTARIO=valor # esto no es parte del valor',
        '',
      ].join('\n')
    );

    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe('https://abc.supabase.co');
    expect(env.CON_COMILLAS).toBe('valor con espacios');
    expect(env.SIMPLES).toBe('otro valor');
    expect(env.CON_COMENTARIO).toBe('valor');
  });

  it('dentro de comillas, el `#` es parte del valor', () => {
    expect(readEnvContent('CLAVE="a#b"').CLAVE).toBe('a#b');
  });

  it('no se rompe con contenido vacío o líneas sueltas', () => {
    expect(readEnvContent('')).toEqual({});
    expect(readEnvContent('sin-igual')).toEqual({});
    expect(readEnvContent(null as unknown as string)).toEqual({});
  });
});

describe('classifySupabaseUrl', () => {
  it('rechaza el placeholder con un motivo claro', () => {
    const result = classifySupabaseUrl('https://placeholder-project.supabase.co');

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/placeholder/i);
  });

  it('rechaza la falta de variable, lo que no es una URL y lo que no es https', () => {
    expect(classifySupabaseUrl(undefined).ok).toBe(false);
    expect(classifySupabaseUrl('').ok).toBe(false);
    expect(classifySupabaseUrl('no-soy-una-url').ok).toBe(false);
    expect(classifySupabaseUrl('http://abc.supabase.co').ok).toBe(false);
  });

  it('acepta localhost en http: es donde se prueba el script con un servidor falso', () => {
    expect(classifySupabaseUrl('http://127.0.0.1:54321').ok).toBe(true);
  });

  it('acepta un proyecto real y devuelve su referencia', () => {
    const result = classifySupabaseUrl('https://abcdefghijkl.supabase.co');

    expect(result.ok).toBe(true);
    expect(result.ok === true && result.ref).toBe('abcdefghijkl');
  });

  it('acepta un dominio propio, avisando que no se puede deducir la referencia', () => {
    // Configuración legítima de Supabase: si se rechazara, el script diría que
    // algo está mal cuando está bien.
    const result = classifySupabaseUrl('https://auth.rix7.cl');

    expect(result.ok).toBe(true);
    expect(result.ok === true && result.ref).toBeNull();
    expect(result.ok === true && result.note).toMatch(/Dominio propio/);
  });
});

describe('classifyAnonKey', () => {
  it('rechaza el placeholder', () => {
    expect(classifyAnonKey('placeholder-anon-key').ok).toBe(false);
  });

  it('acepta las dos formas reales (JWT y clave publicable)', () => {
    expect(classifyAnonKey('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc.def').ok).toBe(true);
    expect(classifyAnonKey('sb_publishable_abcdefghij').ok).toBe(true);
  });

  it('rechaza algo que no tiene forma de clave', () => {
    expect(classifyAnonKey('12345').ok).toBe(false);
    expect(classifyAnonKey(undefined).ok).toBe(false);
  });
});

describe('summarizeSettings', () => {
  it('detecta que el correo está habilitado y Google no', () => {
    const summary = summarizeSettings({ external: { email: true, google: false } });

    expect(summary.emailEnabled).toBe(true);
    expect(summary.googleEnabled).toBe(false);
    expect(summary.notes).toEqual([]);
  });

  it('avisa cuando el correo está deshabilitado: sin eso no hay enlace mágico', () => {
    const summary = summarizeSettings({ external: { email: false } });

    expect(summary.emailEnabled).toBe(false);
    expect(summary.notes.join(' ')).toMatch(/DESHABILITADO/);
  });

  it('avisa si las altas están cerradas o la confirmación en automático', () => {
    const summary = summarizeSettings({
      external: { email: true, google: true },
      disable_signup: true,
      mailer_autoconfirm: true,
    });

    expect(summary.signupsDisabled).toBe(true);
    expect(summary.autoconfirm).toBe(true);
    expect(summary.notes).toHaveLength(2);
    expect(summary.notes.join(' ')).toMatch(/altas están deshabilitadas/);
  });

  it('no se rompe si la respuesta viene rara', () => {
    const summary = summarizeSettings(null);

    // Sin respuesta no se puede afirmar que esté deshabilitado.
    expect(summary.emailEnabled).toBe(true);
    expect(summary.googleEnabled).toBe(false);
  });
});

describe('buildOtpPayload', () => {
  it('pide el enlace creando la cuenta si no existe', () => {
    const payload = buildOtpPayload({ email: 'a@b.cl', redirectTo: 'https://rix7.cl/properties/x' });

    expect(payload).toEqual({
      email: 'a@b.cl',
      create_user: true,
      gotrue_meta_security: {},
      redirect_to: 'https://rix7.cl/properties/x',
    });
  });

  it('no inventa un `redirect_to` vacío', () => {
    expect(buildOtpPayload({ email: 'a@b.cl' })).not.toHaveProperty('redirect_to');
  });

  it('nunca manda PKCE: el verificador no estaría en el navegador que abra el enlace', () => {
    expect(buildOtpPayload({ email: 'a@b.cl' })).not.toHaveProperty('code_challenge');
  });
});

describe('authEndpoints', () => {
  it('arma los endpoints sin barra doble', () => {
    const endpoints = authEndpoints('https://abc.supabase.co/');

    expect(endpoints.settings).toBe('https://abc.supabase.co/auth/v1/settings');
    expect(endpoints.otp).toBe('https://abc.supabase.co/auth/v1/otp');
  });
});

describe('inboxChecklist', () => {
  it('manda a mirar la bandeja, el idioma y a dónde vuelve el enlace', () => {
    const items = inboxChecklist({ email: 'a@b.cl', redirectTo: 'https://rix7.cl/favoritos' }).join(
      '\n'
    );

    expect(items).toContain('a@b.cl');
    expect(items).toMatch(/ESPAÑOL/);
    expect(items).toContain('https://rix7.cl/favoritos');
    expect(items).toMatch(/Redirect URLs/);
    expect(items).toMatch(/Google/);
  });

  it('sin destino concreto no promete una URL que no se pidió', () => {
    const items = inboxChecklist({ email: 'a@b.cl', redirectTo: null }).join('\n');

    expect(items).not.toContain('null');
    expect(items).toMatch(/la misma página desde la que se pidió/);
  });

  it('recuerda el límite del proveedor integrado', () => {
    expect(BUILT_IN_EMAIL_LIMIT_PER_HOUR).toBe(2);
  });
});
