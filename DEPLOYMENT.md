# Fivo - Guía de Deployment

Esta guía te ayudará a desplegar Fivo en producción usando **Vercel** (frontend) y **Railway** (backend).

## Arquitectura de Deployment

```
┌─────────────────────────────────────────────────────────┐
│  VERCEL (Frontend)                                      │
│  - React + TypeScript + Vite                            │
│  - Archivos estáticos en CDN                            │
│  - URL: https://tu-proyecto.vercel.app                  │
└─────────────────┬───────────────────────────────────────┘
                  │ API Calls
                  ↓
┌─────────────────────────────────────────────────────────┐
│  RAILWAY (Backend)                                      │
│  ┌──────────────────────────────────────────┐          │
│  │ Docker Container                          │          │
│  │  ├── Node.js BFF (Express)               │          │
│  │  └── C++ Core Engine (fivo_demo binary) │          │
│  └──────────────────────────────────────────┘          │
│  - URL: https://tu-proyecto.railway.app                │
└─────────────────────────────────────────────────────────┘
```

---

## Preparación Previa

### 1. Instalar Dependencias Actualizadas

```bash
cd ~/Downloads/Fivo/bff
npm install
```

### 2. Verificar que Todo Funciona Localmente

**Terminal 1 - Backend:**
```bash
cd ~/Downloads/Fivo/bff
npm start
```

**Terminal 2 - Frontend:**
```bash
cd ~/Downloads/Fivo/frontend
npm run dev
```

Abre http://localhost:5173 y verifica que la aplicación funcione correctamente.

---

## Parte 1: Desplegar Backend en Railway

### Paso 1: Crear Cuenta en Railway

1. Ve a [railway.app](https://railway.app)
2. Crea una cuenta (puedes usar GitHub)
3. Railway ofrece $5 USD de crédito gratis mensualmente

### Paso 2: Subir Código a GitHub

```bash
cd ~/Downloads/Fivo

# Inicializar repositorio git si no existe
git init

# Agregar .gitignore
cat > .gitignore << 'EOF'
# Dependencies
node_modules/
bff/node_modules/
frontend/node_modules/

# Build outputs
build/
frontend/dist/

# Environment files
.env
.env.local
.env.*.local

# Logs
*.log
npm-debug.log*
bff_output.log

# OS files
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/
*.swp

# Temporary
tmp/
temp/
EOF

# Agregar archivos
git add .
git commit -m "Initial commit: Fivo project with deployment config"

# Crear repositorio en GitHub y pushearlo
# (Reemplaza <tu-usuario> y <tu-repo> con tus valores)
git remote add origin https://github.com/<tu-usuario>/<tu-repo>.git
git branch -M main
git push -u origin main
```

### Paso 3: Crear Proyecto en Railway

1. En Railway dashboard, click **"New Project"**
2. Selecciona **"Deploy from GitHub repo"**
3. Autoriza Railway a acceder a tu GitHub
4. Selecciona el repositorio de Fivo
5. Railway detectará automáticamente el `Dockerfile`

### Paso 4: Configurar Variables de Entorno en Railway

En el dashboard de Railway, ve a tu proyecto → **Variables**:

```bash
NODE_ENV=production
PORT=3001
ALLOWED_ORIGINS=https://tu-proyecto.vercel.app
RATE_LIMIT_MAX=100
```

**IMPORTANTE:** Actualiza `ALLOWED_ORIGINS` con tu URL de Vercel una vez la obtengas.

### Paso 5: Desplegar

1. Railway automáticamente iniciará el build
2. El proceso tardará 3-5 minutos (compilar C++ + instalar dependencias)
3. Una vez completado, Railway te dará una URL pública
4. **Copia esta URL** (la necesitarás para el frontend)

Ejemplo: `https://fivo-production.up.railway.app`

### Paso 6: Verificar Deployment

```bash
curl https://tu-proyecto.railway.app/
# Debe responder: "Fivo Bridge API is running..."

curl "https://tu-proyecto.railway.app/api/chord?key=C&root=G"
# Debe devolver JSON con datos del acorde
```

---

## Parte 2: Desplegar Frontend en Vercel

### Paso 1: Crear Cuenta en Vercel

1. Ve a [vercel.com](https://vercel.com)
2. Crea una cuenta (usa el mismo GitHub)
3. Vercel ofrece hosting gratuito para proyectos personales

### Paso 2: Configurar Variables de Entorno Locales

Antes de desplegar, crea un archivo de entorno para producción:

```bash
cd ~/Downloads/Fivo/frontend

# Crear archivo .env.production
cat > .env.production << 'EOF'
VITE_API_BASE_URL=https://tu-proyecto.railway.app/api
EOF
```

**IMPORTANTE:** Reemplaza `tu-proyecto.railway.app` con la URL real de Railway.

### Paso 3: Verificar Build Local

```bash
cd ~/Downloads/Fivo/frontend
npm run build
npm run preview
```

Abre http://localhost:4173 y verifica que funcione correctamente.

### Paso 4: Desplegar a Vercel

**Opción A: Desde la Web (Recomendado)**

1. Ve a [vercel.com/new](https://vercel.com/new)
2. Importa tu repositorio de GitHub
3. Configura el proyecto:
   - **Framework Preset:** Vite
   - **Root Directory:** `frontend`
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
4. Agrega variables de entorno:
   - `VITE_API_BASE_URL` = `https://tu-proyecto.railway.app/api`
5. Click **Deploy**

**Opción B: Desde la Terminal**

```bash
cd ~/Downloads/Fivo/frontend

# Instalar Vercel CLI
npm install -g vercel

# Login
vercel login

# Desplegar
vercel --prod
```

### Paso 5: Actualizar CORS en Railway

Ahora que tienes la URL de Vercel, actualiza la variable de entorno en Railway:

1. Ve a Railway dashboard → Tu proyecto → **Variables**
2. Actualiza `ALLOWED_ORIGINS`:
   ```
   ALLOWED_ORIGINS=https://tu-proyecto.vercel.app,https://tu-proyecto-git-main.vercel.app
   ```
3. Railway redesplegará automáticamente

---

## Parte 3: Verificación Final

### Tests de Integración

```bash
# 1. Verificar que el frontend carga
curl -I https://tu-proyecto.vercel.app
# Debe responder 200 OK

# 2. Verificar que el backend responde
curl https://tu-proyecto.railway.app/api/chord?key=C&root=G
# Debe devolver JSON válido

# 3. Abrir en navegador
open https://tu-proyecto.vercel.app
```

### Checklist Final

- [ ] Backend Railway responde en `/api/chord` y `/api/context`
- [ ] Frontend Vercel carga correctamente
- [ ] Circle of Fifths es interactivo
- [ ] Al hacer click en un acorde, se reproduce audio
- [ ] No hay errores de CORS en la consola del navegador
- [ ] Los controles (inversión, octava) funcionan correctamente

---

## Troubleshooting

### Error: "Failed to fetch" en el Frontend

**Problema:** CORS bloqueado o URL incorrecta.

**Solución:**
1. Verifica que `VITE_API_BASE_URL` esté configurada en Vercel
2. Verifica que `ALLOWED_ORIGINS` incluya tu dominio de Vercel en Railway
3. Chequea logs en Railway: `railway logs`

### Error: "Failed to execute Core logic" en Backend

**Problema:** El binario C++ no se compiló correctamente.

**Solución:**
1. Revisa logs de build en Railway
2. Verifica que el `Dockerfile` esté en la raíz del proyecto
3. Asegúrate de que los archivos C++ estén en el repositorio

### Error 500 en `/api/chord`

**Problema:** Parámetros inválidos o binario no encontrado.

**Solución:**
1. Verifica logs en Railway: `railway logs`
2. Prueba endpoint con parámetros válidos:
   ```bash
   curl "https://tu-proyecto.railway.app/api/chord?key=C&root=G&inversion=0"
   ```

### Build Lento en Railway

**Problema:** La compilación de C++ tarda 3-5 minutos.

**Solución:**
- Esto es normal. Railway compila el código C++ desde cero.
- El build solo ocurre cuando haces cambios.
- Considera usar Railway's caching para builds futuros.

---

## Monitoreo y Logs

### Ver Logs en Railway

```bash
# Instalar Railway CLI
npm install -g @railway/cli

# Login
railway login

# Ver logs
railway logs
```

### Ver Logs en Vercel

```bash
# Ver logs desde CLI
vercel logs tu-proyecto

# O desde el dashboard:
# https://vercel.com/dashboard → Tu proyecto → Deployments → View Logs
```

---

## Costos Estimados

### Vercel (Frontend)
- **Plan Hobby (Free):**
  - 100 GB bandwidth/mes
  - Builds ilimitados
  - Custom domains
  - **Costo: $0/mes**

### Railway (Backend)
- **Plan Developer:**
  - $5 USD crédito gratis/mes
  - $0.000231 USD por GB-hora de RAM
  - $0.000463 USD por vCPU-hora
  - Estimado para Fivo: ~$3-5 USD/mes
  - **Costo: ~$0-3 USD/mes** (depende del tráfico)

**Total estimado: $0-3 USD/mes**

---

## Optimizaciones Futuras

### Performance
1. **CDN para Assets:** Vercel ya lo hace automáticamente
2. **Caching de Requests:** Implementar Redis en Railway
3. **Comprimir Binario C++:** Usar strip para reducir tamaño

### Seguridad
1. **Rate Limiting Avanzado:** Usar Redis para límites distribuidos
2. **API Keys:** Implementar autenticación para el BFF
3. **Monitoring:** Agregar Sentry para error tracking

### Escalabilidad
1. **Auto-scaling:** Railway escala automáticamente
2. **Load Balancing:** Railway lo maneja
3. **WebSockets:** Para features en tiempo real futuras

---

## Comandos Útiles

```bash
# Reinstalar dependencias del BFF
cd ~/Downloads/Fivo/bff && npm install

# Rebuild del proyecto localmente
cd ~/Downloads/Fivo && ./build_manual.sh

# Ver versión del binario
~/Downloads/Fivo/build/bin/fivo_demo --version

# Probar binario directamente
~/Downloads/Fivo/build/bin/fivo_demo --json C G --inversion 0

# Limpiar build y reconstruir
rm -rf ~/Downloads/Fivo/build && mkdir build && cd build && cmake .. && make
```

---

## Contacto y Soporte

Si encuentras problemas durante el deployment:

1. Revisa los logs de Railway y Vercel
2. Verifica que todas las variables de entorno estén configuradas
3. Prueba endpoints individualmente con curl
4. Revisa la consola del navegador para errores de CORS

---

## Siguiente Paso

Una vez desplegado, considera:
1. Agregar un dominio personalizado (Vercel lo hace fácil)
2. Configurar SSL (automático en Vercel y Railway)
3. Implementar analytics (Google Analytics, Plausible)
4. Agregar más features musicales

**¡Felicidades! Tu aplicación Fivo está en producción 🎵🚀**
