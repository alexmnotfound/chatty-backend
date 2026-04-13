# Chatty — Backend

API y webhook de WhatsApp para Chatty: inbox de equipo con agentes de IA (recepcionista, vendedor) y tareas derivadas de las conversaciones.

## Stack

- Express + TypeScript
- Prisma ORM (SQLite en desarrollo, Postgres en producción)
- OpenAI API (gpt-4o-mini)
- Meta WhatsApp Cloud API

## Requisitos

- Node 18+
- Cuenta Meta (Facebook) con WhatsApp Business API
- OpenAI API key

## Instalación

```bash
npm install
```

## Configuración

1. Copiar variables de entorno:

```bash
cp .env.example .env
```

2. Editar `.env`:

- `DATABASE_URL`: por defecto `file:./dev.db` (SQLite). En producción usar Postgres: `postgresql://user:pass@host:5432/db`
- `JWT_SECRET`: clave secreta para sesiones (**mínimo 32 caracteres**). Generar: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- `WHATSAPP_VERIFY_TOKEN`: token que configurás en Meta para verificar el webhook (ej. `chatty-verify`)
- `WHATSAPP_APP_SECRET`: Meta App Secret para verificar HMAC de webhooks entrantes
- `WHATSAPP_ACCESS_TOKEN`: token de la app de Meta (WhatsApp > API Setup)
- `WHATSAPP_PHONE_NUMBER_ID`: ID del número de teléfono en Meta
- `OPENAI_API_KEY`: clave de OpenAI para los agentes

3. Crear base de datos y datos iniciales (roles IA):

```bash
npx prisma db push
npm run db:seed
```

## Desarrollo

```bash
npm run dev    # tsx watch en :3000
```

## WhatsApp Cloud API (Meta)

1. Entrá a [developers.facebook.com](https://developers.facebook.com), creá una app y agregá el producto "WhatsApp".
2. En WhatsApp > API Setup obtené el **Phone number ID** y generá un **Access token**.
3. En WhatsApp > Configuración, sección **Webhook**:
   - **URL de devolución de llamada**: `https://tu-dominio.com/webhook/whatsapp`
   - **Token de verificación**: el mismo valor que `WHATSAPP_VERIFY_TOKEN` en `.env`.
   - Clic en **Verificar y guardar**.
4. **Suscribirse a "messages"**: en la misma página, marcá **messages** para recibir los chats.

Ver [docs/whatsapp-token.md](docs/whatsapp-token.md) para más detalles sobre tokens y errores comunes.

### ngrok (solo desarrollo local)

```bash
ngrok http 3000
```

Usá la URL `https://xxx.ngrok-free.app/webhook/whatsapp` como URL de devolución de llamada en Meta. La URL cambia cada vez que reiniciás ngrok (versión gratuita).

## Build y despliegue

```bash
npm run build          # tsc → dist/
node dist/index.js     # o usar PM2: pm2 start dist/index.js
```

En producción: Postgres vía `DATABASE_URL`, HTTPS para el webhook, y todas las variables de entorno en el hosting (no usar `.env`).
