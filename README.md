# Chatty — Backend

API y webhook de WhatsApp para Chatty: inbox de equipo multi-tenant con agentes de IA (recepcionista, vendedor) y tareas derivadas de las conversaciones.

## Stack

- Express + TypeScript
- Prisma ORM + PostgreSQL
- OpenAI API (gpt-4o-mini)
- Meta WhatsApp Cloud API

## Arquitectura multi-tenant

Chatty es una plataforma SaaS donde múltiples empresas comparten la misma instancia. Cada empresa tiene sus propios usuarios, conversaciones, bots y credenciales.

- **Super Admin**: administrador global que crea y gestiona empresas. Accede en `/super/login`.
- **Company Admin**: administrador de una empresa. Gestiona su equipo, bots, y credenciales de WhatsApp/OpenAI.
- **Agent**: miembro del equipo de una empresa que atiende conversaciones.

Los datos están aislados por `companyId` en todas las tablas. Los JWT incluyen `scope: "super"` o `scope: "member"` para separar los dos niveles de autenticación.

## Requisitos

- Node 18+
- Docker (para Postgres local)

## Instalación

```bash
npm install
```

## Configuración

1. Levantar Postgres con Docker:

```bash
docker compose up -d
```

Esto inicia PostgreSQL 16 en el puerto **5433** (para evitar conflictos con otros contenedores Postgres).

2. Copiar variables de entorno:

```bash
cp .env.example .env
```

3. Editar `.env`:

- `DATABASE_URL`: por defecto apunta al Postgres local (`localhost:5433`)
- `JWT_SECRET`: clave secreta para sesiones (**mínimo 32 caracteres**). Generar con: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- `WHATSAPP_VERIFY_TOKEN`: token para verificar el webhook en Meta (ej. `chatty-verify`)
- Las credenciales de WhatsApp y OpenAI son opcionales en `.env` — cada empresa las configura desde su panel de Settings

4. Crear base de datos y datos iniciales:

```bash
npx prisma db push
npm run db:seed
```

El seed crea:
- **Super admin**: `super@chatty.com` / `superadmin123`
- **Empresa demo**: slug `demo`
- **Admin demo**: `admin@demo.com` / `admin123`
- **Roles de IA**: Recepcionista y Vendedor para la empresa demo

## Desarrollo

```bash
npm run dev    # tsx watch en :3000
```

## Credenciales por empresa

Cada empresa configura sus propias credenciales desde Settings (solo admin):

- **WhatsApp Phone Number ID**: el ID del número en Meta
- **WhatsApp Access Token**: token de la app de Meta
- **WhatsApp App Secret**: para verificar HMAC de webhooks
- **OpenAI API Key**: clave para los agentes de IA

Si una empresa no tiene credenciales configuradas, el sistema usa los valores de `.env` como fallback.

## WhatsApp Cloud API (Meta)

1. Entrá a [developers.facebook.com](https://developers.facebook.com), creá una app y agregá el producto "WhatsApp".
2. En WhatsApp > API Setup obtené el **Phone number ID** y generá un **Access token**.
3. En WhatsApp > Configuración, sección **Webhook**:
   - **URL de devolución de llamada**: `https://tu-dominio.com/webhook/whatsapp`
   - **Token de verificación**: el mismo valor que `WHATSAPP_VERIFY_TOKEN` en `.env`.
   - Clic en **Verificar y guardar**.
4. **Suscribirse a "messages"**: en la misma página, marcá **messages** para recibir los chats.

El webhook rutea automáticamente los mensajes a la empresa correcta usando el `phone_number_id` que envía Meta en cada payload.

Ver [docs/whatsapp-token.md](docs/whatsapp-token.md) para más detalles sobre tokens y errores comunes.

### ngrok (solo desarrollo local)

```bash
ngrok http 3000
```

Usá la URL `https://xxx.ngrok-free.app/webhook/whatsapp` como URL de devolución de llamada en Meta.

## Build y despliegue

```bash
npm run build          # tsc -> dist/
node dist/index.js     # o usar PM2: pm2 start dist/index.js
```

En producción: Postgres vía `DATABASE_URL`, HTTPS para el webhook, y todas las variables de entorno en el hosting (no usar `.env`).
