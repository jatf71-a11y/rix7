/**
 * `/api/dev/outbox` — buzón de salida local (solo desarrollo).
 *
 * No existe en producción: `isOutboxEnabled()` exige `DEV_EMAIL_OUTBOX=1` y
 * `VERCEL` sin marcar, y si no se cumple la ruta responde 404. No es una
 * protección de seguridad (en Vercel no hay nada que proteger: no se guarda
 * ninguna copia), es la constancia de que en el deploy esta pieza no está.
 *
 * Sirve tres formatos desde el mismo GET:
 *
 * - `GET /api/dev/outbox` → JSON con los metadatos de cada mensaje (para
 *   tests scripts y para mirar qué pasó por `sendEmail`).
 * - `GET /api/dev/outbox?id=correo-1` → el mensaje entero en JSON.
 * - `GET /api/dev/outbox?id=correo-1&format=html` → el HTML tal cual como
 *   lo vería la persona en su bandeja: es la forma de revisar la bienvenida
 *   en el navegador sin una clave de Resend.
 * - `DELETE /api/dev/outbox` → vacía el buzón entre pruebas.
 */

import { NextRequest, NextResponse } from 'next/server';
import { clearOutbox, getOutbox, isOutboxEnabled, listOutbox } from '@/lib/email/outbox';

export const dynamic = 'force-dynamic';

function gone(): NextResponse {
  return NextResponse.json(
    { success: false, error: 'Buzón de salida no disponible (solo desarrollo con DEV_EMAIL_OUTBOX=1).' },
    { status: 404 }
  );
}

export async function GET(request: NextRequest) {
  if (!isOutboxEnabled()) return gone();

  const id = request.nextUrl.searchParams.get('id');
  const format = request.nextUrl.searchParams.get('format');

  if (!id) {
    const messages = listOutbox().map(({ html: _html, text: _text, ...meta }) => meta);
    return NextResponse.json({ success: true, data: messages, count: messages.length });
  }

  const entry = getOutbox(id);
  if (!entry) {
    return NextResponse.json({ success: false, error: 'Ese correo ya no está en el buzón.' }, { status: 404 });
  }

  if (format === 'html') {
    return new NextResponse(entry.html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  return NextResponse.json({ success: true, data: entry });
}

export async function DELETE() {
  if (!isOutboxEnabled()) return gone();
  const removed = clearOutbox();
  return NextResponse.json({ success: true, removed });
}
