import { configDefaults, defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    include: ['**/*.test.ts'],
    /**
     * Se excluyen los directorios de trabajo que el proyecto crea al lado del
     * código: `.deploy-staging` (la copia sin metadata de git que publica
     * `deploy:prod`) y `.build-check` (la copia para verificar un build). Sin
     * esto, una copia que quede en disco —el `rmSync` del deploy puede fallar con
     * EPERM en Windows— duplica cada archivo de test y el conteo de la suite deja
     * de significar algo: llegó a reportar 952 tests cuando son 476.
     */
    exclude: [...configDefaults.exclude, '**/.deploy-staging/**', '**/.build-check/**'],
    environment: 'node',
    /**
     * El de por defecto (5 s) se pasó alguna vez con la máquina cargada —un
     * build de Next en paralelo, el antivirus escaneando la copia de trabajo— y
     * un test puro de milisegundos "falló" sin que hubiera nada roto. Un test
     * intermitente obliga a desconfiar de la suite entera, así que se deja aire:
     * sigue siendo finito y una espera de verdad se sigue notando.
     */
    testTimeout: 15000,
    hookTimeout: 15000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
