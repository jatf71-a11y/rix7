import { redirect } from 'next/navigation';

/**
 * El alta de empresas ya no es una pantalla aparte.
 *
 * El equipo leía dos bandejas para la misma pregunta —la de «Publicar» y esta— y
 * tenía que recordar en cuál estaba cada corredora. Ahora las altas evaluadas y
 * los registros de agentes se miran juntos en Solicitudes, filtrados por
 * categoría de socio.
 *
 * La ruta sigue existiendo para no romper un enlace guardado ni un correo viejo
 * del equipo: redirige en vez de dar un 404.
 */
export default function AltaEmpresasPage() {
  redirect('/admin/solicitudes');
}
