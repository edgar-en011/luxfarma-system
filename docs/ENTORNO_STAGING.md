# Entorno de pruebas

Usa un proyecto Supabase independiente para pruebas. No apuntes la aplicación de
pruebas a la URL ni a las credenciales de producción.

1. Crea un proyecto Supabase separado y copia su URL y su clave `anon` a una
   copia local de `.env.staging.example` llamada `.env.staging.local`.
2. Configura `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY` y/o `OPENAI_API_KEY`
   como secretos de las Edge Functions del proyecto de pruebas. Nunca los pongas
   en variables `VITE_*`.
3. Aplica las migraciones y el esquema base en el proyecto de pruebas antes de
   conectar la aplicación. Las migraciones de este repositorio no se aplican
   automáticamente.
4. Mantén las pruebas de facturación electrónica desactivadas y usa datos
   ficticios. No importes datos de clientes ni credenciales reales.
5. Ejecuta `npm run dev` después de cargar las variables locales del entorno de
   pruebas. Verifica login, ventas, lotes y el asistente con cuentas de prueba.

`.env.staging.local` está ignorado por Git; `.env.staging.example` contiene solo
marcadores vacíos y puede versionarse.
