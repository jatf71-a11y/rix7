# Plantilla del enlace mágico

`magic-link.html` es la plantilla lista para pegar en Supabase. Traduce al español
y pone la marca de Rix7 en el correo que hoy llega genérico y en inglés.

## Dónde se pega

**Authentication » Emails » Magic Link**, en *Supabase → Project Settings*. Son dos campos:

| Campo | Valor |
|---|---|
| **Subject heading** | `Tu enlace para entrar a Rix7` |
| **Message body** | todo el contenido de `magic-link.html` |

> Ojo: Supabase guarda la plantilla **por proyecto**, no en el repositorio. Por eso
> este archivo existe: es la copia versionada de lo que hay que pegar, para que no
> se pierda cuando alguien más toque la configuración desde el panel.

## Variables que usa

| Variable | Qué es |
|---|---|
| `{{ .ConfirmationURL }}` | El enlace que deja a la persona dentro. Es el botón. |
| `{{ .Email }}` | El correo al que se envió. Se muestra para que la persona confirme que es el suyo. |
| `{{ .SiteURL }}` | La URL del sitio (la de *URL Configuration*), en el pie. |

No se usa `{{ .Token }}` a propósito: el acceso es por enlace, no por código de 6
dígitos, así que no hay que pedirle a nadie que lo transcriba.

## Dos cosas que hay que mantener en sincronía

1. **"El enlace vence en una hora"** es el valor por defecto de Supabase
   (*Authentication » Configuration » Email OTP Expiration*, 3600 s). Si se cambia
   ese valor, hay que corregir la frase en la plantilla.
2. **Las imágenes**: la plantilla **no usa imágenes remotas ni el logo en archivo**,
   sino el nombre en texto. Los clientes de correo bloquean las imágenes por
   defecto y un correo que depende de ellas llega con un hueco. Cuando haya un logo
   alojado en un dominio propio y verificado, se puede agregar con `alt` y sin
   depender de él para entender el correo.

## Cómo comprobar que quedó bien

`npm run check:auth -- --email tu@correo.cl` manda un enlace real y dice qué revisar
en la bandeja de entrada. Ver la sección de acceso del `README.md`.
