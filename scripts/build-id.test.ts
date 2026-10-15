/**
 * Tests del identificador de la build.
 *
 * Lo que hay que proteger acá son las dos afirmaciones que este módulo hace
 * posibles, porque las dos se pueden equivocar en silencio:
 *
 * 1. **«Este es el árbol que se publica»**: el hash tiene que cambiar cuando
 *    cambia el contenido —incluido un archivo nuevo sin commitear, que *sí*
 *    viaja al deployment— y **no** cambiar cuando lo único distinto es el fin de
 *    línea (Windows vs el checkout de Linux del CI), que es lo que haría dar
 *    falso positivo en cada corrida.
 * 2. **«Lo que está en vivo es este árbol»**: cada veredicto de `compareBuilds`
 *    (`match`, `stale`, `tree-moved`, `differs`, `no-live`, `no-tree`) tiene que
 *    ser alcanzable y decir cuál de las cosas pasó. Un «coincide» de más es el
 *    bug original de todo esto: creer que producción tiene el código del repo.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  BUILD_ID_ENV,
  compareBuilds,
  describeBuild,
  formatBuildComparison,
  formatBuildIdValue,
  gitRelation,
  hashTree,
  isBuildId,
  normalizeEol,
  readTreeBuildId,
  shortId,
} from './build-id.mjs';

const ROOT = path.resolve(__dirname, '..');

/** Una respuesta de git inventada: `run('git', ['rev-parse','HEAD'])` → … */
type RunResult = { code: number; stdout: string } | null;

/** Un `run` de git que contesta según los argumentos, y `null` si no está. */
function fakeRun(responses: Record<string, RunResult>) {
  return (command: string, args: string[]): RunResult => responses[`${command} ${args.join(' ')}`] ?? null;
}

const SHA_A = '9d1c3ab77e5f1234567890abcdef1234567890ab';
const SHA_B = '1122abc77e5f1234567890abcdef1234567890ab';

describe('hashTree', () => {
  it('el mismo contenido en distinto orden da el mismo identificador', () => {
    const uno = [
      { path: 'b.ts', content: 'B' },
      { path: 'a.ts', content: 'A' },
    ];
    const otro = [
      { path: 'a.ts', content: 'A' },
      { path: 'b.ts', content: 'B' },
    ];

    expect(hashTree(uno)).toBe(hashTree(otro));
  });

  it('un byte distinto cambia el identificador', () => {
    const base = [{ path: 'a.ts', content: 'export const a = 1;' }];
    const cambiado = [{ path: 'a.ts', content: 'export const a = 2;' }];

    expect(hashTree(base)).not.toBe(hashTree(cambiado));
  });

  it('mover un archivo de nombre cambia el identificador', () => {
    expect(hashTree([{ path: 'a.ts', content: 'x' }])).not.toBe(hashTree([{ path: 'b.ts', content: 'x' }]));
  });

  it('un archivo de más cambia el identificador (los nuevos sin commitear se publican)', () => {
    const antes = [{ path: 'a.ts', content: 'A' }];
    const despues = [...antes, { path: 'nuevo.ts', content: 'N' }];

    expect(hashTree(antes)).not.toBe(hashTree(despues));
  });

  it('el fin de línea no cambia el identificador: es el mismo árbol', () => {
    const crlf = [{ path: 'a.ts', content: Buffer.from('linea1\r\nlinea2\r\n', 'utf8') }];
    const lf = [{ path: 'a.ts', content: Buffer.from('linea1\nlinea2\n', 'utf8') }];

    expect(hashTree(crlf)).toBe(hashTree(lf));
  });

  it('un binario con bytes raros no se reinterpreta', () => {
    // El viaje por latin1 para normalizar tiene que ser ida y vuelta byte a
    // byte: si reinterpretara, dos videos distintos darían el mismo hash.
    const uno = [{ path: 'video.mp4', content: Buffer.from([0xff, 0xfe, 0x00, 0x0d, 0x0a]) }];
    const otro = [{ path: 'video.mp4', content: Buffer.from([0xff, 0xfd, 0x00, 0x0d, 0x0a]) }];

    expect(hashTree(uno)).not.toBe(hashTree(otro));
    expect(hashTree(uno)).toBe(hashTree([{ path: 'video.mp4', content: Buffer.from([0xff, 0xfe, 0x00, 0x0d, 0x0a]) }]));
  });

  it('devuelve 16 hex', () => {
    expect(hashTree([{ path: 'a', content: 'a' }])).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('normalizeEol', () => {
  it('pasa CRLF a LF sin tocar otros bytes', () => {
    expect(normalizeEol(Buffer.from('a\r\nb', 'utf8')).toString('utf8')).toBe('a\nb');
  });

  it('deja intacto lo que ya está en LF y no paga el costo en binarios', () => {
    const binario = Buffer.from([0x00, 0x01, 0x02]);
    expect(normalizeEol(binario)).toBe(binario);
  });
});

describe('formato del valor publicado', () => {
  it('arma el valor con la forma documentada', () => {
    expect(formatBuildIdValue({ id: '4f2a3c4b5d6e7f80', commit: SHA_A, dirty: true, builtAt: 1760361600 })).toBe(
      `1.4f2a3c4b5d6e7f80.${SHA_A}.1.1760361600`
    );
  });

  it('solo usa caracteres seguros para la línea de comandos', () => {
    // Viaja como argumento hacia `npx vercel` a través de `cmd.exe` en Windows:
    // un espacio, una comilla o un `|` y el deploy recibiría otra cosa.
    const value = formatBuildIdValue({ id: '4f2a3c4b5d6e7f80', commit: SHA_A, dirty: false, builtAt: 1760361600 })!;
    expect(value).toMatch(/^[0-9a-f.-]+$/);
  });

  it('sin commit o sin sello de tiempo sigue siendo un valor válido', () => {
    expect(formatBuildIdValue({ id: '4f2a3c4b5d6e7f80' })).toBe('1.4f2a3c4b5d6e7f80.-.0.0');
  });

  it('sin identificador no inventa un valor', () => {
    expect(formatBuildIdValue({ id: '' })).toBeNull();
    expect(formatBuildIdValue({ id: 'no-es-hex' })).toBeNull();
  });

  it('isBuildId distingue un identificador de cualquier otra cosa', () => {
    expect(isBuildId('4f2a3c4b5d6e7f80')).toBe(true);
    expect(isBuildId('4F2A3C4B5D6E7F80')).toBe(false);
    expect(isBuildId('4f2a')).toBe(false);
    expect(isBuildId(null)).toBe(false);
  });

  it('la variable de entorno tiene el nombre que lee /api/health', () => {
    // Está escrito dos veces a propósito (acá y en `lib/utils/buildId.ts`, que es
    // quien la lee): si alguien renombra una sola, esto lo dice.
    expect(BUILD_ID_ENV).toBe('RIX7_BUILD');
  });
});

describe('describeBuild / shortId', () => {
  it('nombra el identificador con el commit y el estado del árbol', () => {
    expect(describeBuild({ id: '4f2a3c4b5d6e7f80', commit: SHA_A, dirty: true, changed: 17 })).toBe(
      '4f2a3c4b… · commit 9d1c3ab · con 17 archivos sin commitear'
    );
  });

  it('en vivo solo hay un booleano: no inventa cuántos archivos', () => {
    expect(describeBuild({ id: '4f2a3c4b5d6e7f80', commit: SHA_A, dirty: true })).toContain('con cambios sin commitear');
  });

  it('un árbol limpio lo dice', () => {
    expect(describeBuild({ id: '4f2a3c4b5d6e7f80', dirty: false })).toBe('4f2a3c4b… · árbol limpio');
  });

  it('sin identificador no dice «coincide» ni nada parecido', () => {
    expect(shortId(null)).toBe('sin identificador');
  });
});

describe('gitRelation', () => {
  it('el mismo commit no necesita mirar la historia', () => {
    const relation = gitRelation({ liveCommit: SHA_A, localCommit: SHA_A, run: () => null });
    expect(relation).toEqual({ relation: 'same', count: 0, detail: 'mismo commit' });
  });

  it('cuenta los commits cuando producción está atrás', () => {
    const relation = gitRelation({
      liveCommit: SHA_B,
      localCommit: SHA_A,
      run: fakeRun({
        [`git cat-file -e ${SHA_B}^{commit}`]: { code: 0, stdout: '' },
        [`git merge-base --is-ancestor ${SHA_B} ${SHA_A}`]: { code: 0, stdout: '' },
        [`git rev-list --count ${SHA_B}..${SHA_A}`]: { code: 0, stdout: '3\n' },
      }),
    });

    expect(relation?.relation).toBe('behind');
    expect(relation?.count).toBe(3);
    expect(relation?.detail).toContain('3 commits atrás');
  });

  it('también cuenta cuando producción va adelante del árbol', () => {
    const relation = gitRelation({
      liveCommit: SHA_B,
      localCommit: SHA_A,
      run: fakeRun({
        [`git cat-file -e ${SHA_B}^{commit}`]: { code: 0, stdout: '' },
        [`git merge-base --is-ancestor ${SHA_B} ${SHA_A}`]: { code: 1, stdout: '' },
        [`git merge-base --is-ancestor ${SHA_A} ${SHA_B}`]: { code: 0, stdout: '' },
        [`git rev-list --count ${SHA_A}..${SHA_B}`]: { code: 0, stdout: '2\n' },
      }),
    });

    expect(relation?.relation).toBe('ahead');
    expect(relation?.detail).toContain('2 commits que');
  });

  it('sin historia compartida lo dice, en vez de elegir un lado', () => {
    const relation = gitRelation({
      liveCommit: SHA_B,
      localCommit: SHA_A,
      run: fakeRun({
        [`git cat-file -e ${SHA_B}^{commit}`]: { code: 0, stdout: '' },
        [`git merge-base --is-ancestor ${SHA_B} ${SHA_A}`]: { code: 1, stdout: '' },
        [`git merge-base --is-ancestor ${SHA_A} ${SHA_B}`]: { code: 1, stdout: '' },
      }),
    });

    expect(relation?.relation).toBe('diverged');
  });

  it('un commit que no está en este clon es «no sé», no «historias distintas»', () => {
    // Es el caso de un clon superficial (`fetch-depth: 1`), donde `merge-base`
    // falla: contarlo como divergencia sería inventar un diagnóstico.
    const relation = gitRelation({
      liveCommit: SHA_B,
      localCommit: SHA_A,
      run: fakeRun({ [`git cat-file -e ${SHA_B}^{commit}`]: { code: 1, stdout: '' } }),
    });

    expect(relation?.relation).toBe('unknown');
    expect(relation?.detail).toContain('no está en este clon');
  });

  it('sin alguno de los dos commits no hay nada que comparar', () => {
    expect(gitRelation({ liveCommit: null, localCommit: SHA_A })).toBeNull();
    expect(gitRelation({ liveCommit: SHA_A, localCommit: null })).toBeNull();
  });
});

describe('readTreeBuildId', () => {
  const files = { 'git ls-files --cached --others --exclude-standard -z': { code: 0, stdout: 'a.ts\0b.ts\0' } } as const;
  const state = {
    'git rev-parse HEAD': { code: 0, stdout: `${SHA_A}\n` },
    'git status --porcelain': { code: 0, stdout: ' M a.ts\n?? c.ts\n' },
  } as const;

  it('junta el hash del contenido con el estado de git', () => {
    const tree = readTreeBuildId({
      root: '/repo',
      run: fakeRun({ ...files, ...state }),
      read: (filePath: string) => Buffer.from(`contenido de ${filePath}`, 'utf8'),
      now: () => 1760361600_000,
    });

    expect(tree.error).toBeNull();
    expect(tree.commit).toBe(SHA_A);
    expect(tree.dirty).toBe(true);
    expect(tree.changed).toBe(2);
    expect(tree.files).toBe(2);
    expect(tree.builtAt).toBe(1760361600);
    expect(tree.id).toMatch(/^[0-9a-f]{16}$/);
    expect(tree.value).toBe(`1.${tree.id}.${SHA_A}.1.1760361600`);
  });

  it('un archivo que no se puede leer se informa en vez de saltearse callado', () => {
    const tree = readTreeBuildId({
      root: '/repo',
      run: fakeRun({ ...files, ...state }),
      read: (filePath: string) => {
        if (filePath.endsWith('b.ts')) throw new Error('EACCES');
        return Buffer.from('x', 'utf8');
      },
    });

    expect(tree.skipped).toEqual(['b.ts']);
    expect(tree.files).toBe(1);
    expect(tree.value).not.toBeNull();
  });

  it('sin git no hay identificador, y lo dice: no lanza', () => {
    const tree = readTreeBuildId({ run: () => null });
    expect(tree.value).toBeNull();
    expect(tree.error).toContain('git');
  });

  it('un árbol sin ningún archivo legible es un error, no un hash vacío', () => {
    // Un hash de nada «coincidiría» con otro hash de nada: el peor fallo
    // posible, porque es silencioso.
    const tree = readTreeBuildId({
      run: fakeRun({ ...files, ...state }),
      read: () => {
        throw new Error('EACCES');
      },
    });

    expect(tree.value).toBeNull();
    expect(tree.error).toContain('ningún archivo');
  });

  it('sobre este repositorio da un identificador estable y con commit', () => {
    const uno = readTreeBuildId({ root: ROOT });
    const otro = readTreeBuildId({ root: ROOT });

    expect(uno.error).toBeNull();
    expect(uno.id).toMatch(/^[0-9a-f]{16}$/);
    expect(uno.commit).toMatch(/^[0-9a-f]{40}$/);
    // Dos lecturas del mismo árbol tienen que dar lo mismo: si no, la
    // comparación con producción sería una lotería.
    expect(otro.id).toBe(uno.id);
    expect(otro.files).toBeGreaterThan(50);
  });
});

describe('compareBuilds', () => {
  const live = { id: '9a1b2c3d4e5f6071', commit: SHA_B, dirty: false, builtAt: '2026-10-13T10:00:00.000Z' };
  const expected = { id: '4f2a3c4b5d6e7f80', commit: SHA_A, dirty: true, changed: 17 };
  const published = { id: '4f2a3c4b5d6e7f80' };

  it('coincide: lo publicado es este árbol', () => {
    const same = { ...expected, id: live.id };
    const comparison = compareBuilds({ live, expected: same });

    expect(comparison.status).toBe('match');
    expect(comparison.level).toBe('ok');
    expect(comparison.detail).toContain('coincide');
  });

  it('el despliegue no publica identificador: es «no se pudo comprobar», no un fallo', () => {
    const comparison = compareBuilds({ live: null, expected });

    expect(comparison.status).toBe('no-live');
    expect(comparison.level).toBe('info');
    expect(comparison.hint).toContain('release:prod');
  });

  it('sin árbol local tampoco se afirma nada', () => {
    const comparison = compareBuilds({ live, expected: null });

    expect(comparison.status).toBe('no-tree');
    expect(comparison.level).toBe('info');
  });

  it('en vivo hay otro árbol que el del repo: es el «producción quedó atrás»', () => {
    const comparison = compareBuilds({
      live,
      expected,
      relation: { relation: 'behind', count: 3, detail: 'producción está 3 commits atrás (1122abc → 9d1c3ab)' },
    });

    expect(comparison.status).toBe('differs');
    expect(comparison.level).toBe('warn');
    expect(comparison.detail).toContain('3 commits atrás');
    expect(comparison.hint).toContain('release:prod');
  });

  it('el borde todavía sirve el deployment anterior: «stale», y se arregla reintentando', () => {
    const comparison = compareBuilds({ live, expected, published });

    expect(comparison.status).toBe('stale');
    expect(comparison.detail).toContain('no es lo que este release publicó');
    expect(comparison.hint).toContain('propagarse');
  });

  it('lo publicado sí está en vivo, pero el árbol cambió en el medio: «tree-moved»', () => {
    const comparison = compareBuilds({ live, expected, published: { id: live.id } });

    expect(comparison.status).toBe('tree-moved');
    expect(comparison.detail).toContain('cambió mientras corría el release');
    expect(comparison.hint).toContain('Volvé a correr');
  });

  it('un identificador en vivo con forma rara no cuenta como identificador', () => {
    expect(compareBuilds({ live: { id: 'basura' }, expected }).status).toBe('no-live');
  });
});

describe('formatBuildComparison', () => {
  it('el caso bueno es una línea', () => {
    const lines = formatBuildComparison(
      compareBuilds({ live: { id: '4f2a3c4b5d6e7f80' }, expected: { id: '4f2a3c4b5d6e7f80' } })
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('✓');
    expect(lines[0]).toContain('coincide con el árbol');
  });

  it('cuando no coincide muestra los dos lados y qué hacer', () => {
    const lines = formatBuildComparison(
      compareBuilds({
        live: { id: '9a1b2c3d4e5f6071', commit: SHA_B, dirty: false },
        expected: { id: '4f2a3c4b5d6e7f80', commit: SHA_A, dirty: true, changed: 17 },
      })
    ).join('\n');

    expect(lines).toContain('!');
    expect(lines).toContain('en vivo: 9a1b2c3d… · commit 1122abc');
    expect(lines).toContain('árbol:   4f2a3c4b… · commit 9d1c3ab');
    expect(lines).toContain('release:prod');
  });

  it('sin identificador en vivo no lista dos lados que no existen', () => {
    const lines = formatBuildComparison(compareBuilds({ live: null, expected: { id: '4f2a3c4b5d6e7f80' } }));

    expect(lines.join('\n')).not.toContain('en vivo:');
    expect(lines.join('\n')).toContain('no publica identificador');
  });
});
