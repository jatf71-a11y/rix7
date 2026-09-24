import { describe, it, expect, vi, afterEach } from 'vitest';
import { clientIpFrom, createRateLimiter } from './rateLimit';

afterEach(() => {
  vi.useRealTimers();
});

describe('createRateLimiter', () => {
  it('permite hasta el máximo y rechaza el siguiente', () => {
    const limiter = createRateLimiter({ max: 3, windowMs: 60_000 });

    expect(limiter.isLimited('1.1.1.1')).toBe(false);
    expect(limiter.isLimited('1.1.1.1')).toBe(false);
    expect(limiter.isLimited('1.1.1.1')).toBe(false);
    expect(limiter.isLimited('1.1.1.1')).toBe(true);
  });

  it('cuenta por clave: una IP no consume el cupo de otra', () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 60_000 });

    expect(limiter.isLimited('a')).toBe(false);
    expect(limiter.isLimited('a')).toBe(true);
    expect(limiter.isLimited('b')).toBe(false);
  });

  it('reinicia el cupo al vencer la ventana', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-23T12:00:00Z'));
    const limiter = createRateLimiter({ max: 1, windowMs: 60_000 });

    expect(limiter.isLimited('a')).toBe(false);
    expect(limiter.isLimited('a')).toBe(true);

    vi.advanceTimersByTime(60_001);
    expect(limiter.isLimited('a')).toBe(false);
  });

  it('reset vacía los contadores', () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 60_000 });
    limiter.isLimited('a');
    limiter.reset();
    expect(limiter.isLimited('a')).toBe(false);
  });

  it('no filtra claves viejas cuando el mapa es grande', () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 60_000 });
    // Supera el umbral de barrido (1000 claves) sin fallar ni crecer sin control.
    for (let i = 0; i < 1200; i++) {
      expect(limiter.isLimited(`ip-${i}`)).toBe(false);
    }
    expect(limiter.isLimited('ip-0')).toBe(true);
  });
});

describe('clientIpFrom', () => {
  it('toma la primera IP de x-forwarded-for', () => {
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1, 10.0.0.2' });
    expect(clientIpFrom(headers)).toBe('203.0.113.7');
  });

  it('cae a x-real-ip y, si no hay nada, agrupa bajo unknown', () => {
    expect(clientIpFrom(new Headers({ 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4');
    expect(clientIpFrom(new Headers())).toBe('unknown');
  });
});
