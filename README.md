# Horus · Omega Eléctrica + Lafken Austral

Sistema único que reemplaza a las 4 apps anteriores:

| Módulo | Antes | Empresa por defecto |
|---|---|---|
| **Equipos** (fichas, mediciones, fotos/videos, etiquetas QR) | Control Equipos | Omega |
| **Inventario** (stock, entradas/salidas, escaneo) | Sistema Inventario | Omega |
| **Servicios** (desratización, desinfección…) | Lafken Austral | Lafken |
| **Sala de bombas** (ESP32: temperatura, humedad, presión, movimiento) | omega-sala-bombas | Omega |
| **Bobinado** (ficha técnica de motores rebobinados) — solo operarios con permiso | nuevo | Omega |
| **Lista de precios** (una por mes, solo lectura, búsqueda y variación vs. mes anterior) | nuevo | Omega |

Además, el administrador tiene un **Buscador de Excel** (Administración): abre planillas de compras u otras,
las junta y permite filtrar por mes, proveedor, texto o montos, agrupar y sumar. Los archivos se leen solo
en el navegador: **no se suben ni se guardan**.

Es una página web (HTML + JavaScript, sin frameworks) con los datos en **un solo proyecto Supabase**. Se instala como app en el **celular** (Android/iPhone) y en **Windows** (Chrome o Edge → botón “Instalar app”).

Las apps originales quedaron sin cambios en `legado/` como referencia (esa carpeta no se sube a GitHub porque tiene claves).

## Tipos de usuario

| | Administrador | Operario | Cliente | Visitante (sin sesión) |
|---|---|---|---|---|
| Empresas | Ambas (clic en el logo, arriba) | Solo la suya | Solo la de su cliente | — |
| Ver | Todo | Todo lo de su empresa | Sus equipos, servicios y sala de bombas (lo que el admin le habilite) | Solo la ficha del QR |
| Crear / editar | Todo | Equipos, fotos, productos, movimientos, servicios | Nada | Nada |
| Borrar | Sí | **No** | No | No |
| Gestionar clientes, personal, usuarios, módulos ESP32 | Sí | No (solo los elige en los formularios) | No | No |
| Bobinado | Sí | Solo si el admin le da el permiso (Usuarios → Permisos) | No | No |
| Lista de precios | Ver y cargar/eliminar listas | Solo ver | No | No |
| Buscador de Excel | Sí | No | No | No |
| Historial de cambios | Sí | No | No | No |

- **Ficha limitada** (cliente y visitante): empresa, ID, cliente, tipo de motor, voltaje, mantenimiento, estado y fechas. **No** muestra mediciones, notas, proceso, encargados, fotos ni videos. Se cambia en la función `equipo_limitado` de `supabase/schema.sql`.
- Un operario de Lafken que escanea un QR de Omega ve la ficha limitada.
- Un usuario nuevo queda **“Sin acceso”** hasta que el administrador le asigna un rol.
- Los permisos los aplica la base de datos (Row Level Security), no solo la pantalla: aunque alguien modifique la página, no puede ver ni tocar lo que no le corresponde.

## Puesta en marcha

### 1. Base de datos
1. Crea un proyecto nuevo en [supabase.com](https://supabase.com).
2. **SQL Editor** → pega todo `supabase/schema.sql` → **Run**. Se puede volver a ejecutar sin problemas.
3. **Authentication → Sign In / Providers → Email**: desactiva *Allow new users to sign up*.
4. **Authentication → Users → Add user**: crea **tu** usuario (marca *Auto Confirm User*). Ejecuta `schema.sql` otra vez: el usuario más antiguo queda como **administrador**.

### 2. Función para crear usuarios desde la app (recomendado)
Sin esto, los usuarios se crean en Supabase (Authentication → Users) y el rol se asigna en Horus → Administración → Usuarios.
```bash
npx supabase login
npx supabase functions deploy usuarios --project-ref TU-PROYECTO
```

### 3. Conectar la página
Copia `js/config.example.js` como `js/config.js` y pega la **Project URL** y la clave **publishable (anon)** (Project Settings → API). En el mismo archivo están las listas de sugerencias (tipos de motor, estados, tipos de servicio por empresa).

Probar en tu PC:
```bash
python -m http.server 8000
```
y abre http://localhost:8000

### 4. Migrar los datos antiguos
```bash
cd migracion
npm install
```
Copia `.env.example` como `.env` y complétalo: la clave **secreta** del proyecto nuevo y un usuario de cada app antigua. Las URL de las apps antiguas se leen solas desde `legado/`.
```bash
node migrar.mjs --prueba
```
```bash
node migrar.mjs
```
- `--prueba` solo cuenta los registros. Sin `--prueba` copia todo; se puede repetir sin duplicar.
- Copia los equipos con sus fotos y videos (mismos ID, así **los QR ya impresos siguen sirviendo** si apuntan al nuevo dominio), los productos y movimientos (el stock queda igual) y los clientes, operarios y servicios de Lafken.
- Los clientes de Control Equipos (que eran texto libre) se convierten en clientes de Omega. Revisa en Administración → Clientes si quedaron duplicados por escribirse distinto.
- **Las cuentas de usuario no se migran** (las contraseñas no se pueden copiar). El script lista los usuarios de Lafken para recrearlos.
- Al terminar, **borra `migracion/.env`** (tiene la clave secreta).

### 5. Publicar (GitHub Pages)
En el repositorio de GitHub: **Settings → Secrets and variables → Actions**, crea `SUPABASE_URL` y `SUPABASE_KEY` (la publishable). Luego **Settings → Pages → Source: GitHub Actions**. Cada push a `main` publica la web (HTTPS, necesario para la cámara y para instalarla).

> Imprime las etiquetas QR **desde la dirección definitiva**: el QR lleva la dirección desde donde se abrió la app.
> Los QR antiguos (`…#equipo=ID`) también funcionan en Horus.

## Sala de bombas
1. En Horus → Administración → Sala de bombas: **Agregar módulo** (ID = `DEVICE_ID`, ej. `sala-bombas-01`), asígnale el cliente y define la **Clave ESP32**.
2. **Datos simulados** (sin hardware):
   ```bash
   cd sala-bombas
   ```
   Copia `.env.example` como `.env` y complétalo. Luego:
   ```bash
   node simulador.mjs
   ```
3. **ESP32 real**: abre `sala-bombas/firmware/horus_sala_bombas/` en Arduino IDE, completa `config.h` (WiFi, URL y clave publishable de Supabase, ID y clave del módulo) y súbelo. Conexiones y librerías: igual que en `legado/omega-sala-bombas/README.md`. Ahora envía por HTTPS directo a Supabase, así que ya no hace falta un PC servidor encendido.

Umbrales de alarma: se editan por módulo en Administración → Sala de bombas → Editar. Las lecturas se guardan 90 días.

## Archivos
| Archivo | Para qué |
|---|---|
| `index.html`, `css/horus.css` | Pantalla y estilos |
| `js/app.js` | Sesión, roles, navegación |
| `js/nucleo.js` | Conexión a Supabase, permisos, utilidades |
| `js/equipos.js`, `inventario.js`, `servicios.js`, `sala.js`, `bobinado.js`, `precios.js` | Cada módulo |
| `js/excel.js` | Buscador de Excel (y lectura de Excel para la lista de precios) |
| `js/admin.js` | Usuarios, clientes, personal, módulos ESP32, empresas, historial |
| `js/publico.js` | Ficha limitada (QR) |
| `supabase/schema.sql` | Tablas, permisos por rol, funciones, historial de cambios |
| `supabase/functions/usuarios/` | Crear usuarios y cambiar claves desde la app |
| `migracion/` | Copia los datos de las 3 bases antiguas |
| `sala-bombas/` | Firmware ESP32 y simulador |
| `sw.js`, `manifest.webmanifest`, `icons/` | Instalación como app |

## Límites del plan gratis de Supabase
500 MB de base de datos y 1 GB de archivos para **todo** el sistema (antes eran 3 proyectos con su propio límite). Las fotos se reducen a ~300 KB; los videos y las lecturas de sala de bombas son lo que más ocupa. Si el proyecto no se usa en 7 días, Supabase lo pausa.
