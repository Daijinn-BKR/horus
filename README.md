# Horus · Omega Eléctrica + Lafken Austral

Sistema único que reemplaza a las 4 apps anteriores:

| Módulo | Antes | Empresa por defecto |
|---|---|---|
| **Equipos** (fichas, mediciones, fotos/videos, etiquetas QR) | Control Equipos | Omega |
| **Inventario** (stock, entradas/salidas, escaneo) | Sistema Inventario | Omega |
| **Servicios** (desratización, desinfección…) | Lafken Austral | Lafken |
| **Sanitización** de estanques (Cotizado → Coordinado → Finalizado) | nuevo | Lafken |
| **Sala de bombas** (ESP32: temperatura, humedad, presión, movimiento) | omega-sala-bombas | Omega |
| **Bobinado** (ficha técnica de motores rebobinados) — solo operarios con permiso | nuevo | Omega |
| **Lista de precios** (una por mes, solo lectura, búsqueda y variación vs. mes anterior) | nuevo | Omega |
| **Órdenes de trabajo** (el jefe eléctrico asigna trabajos, el personal los termina con fotos/videos y el jefe los verifica) | nuevo | Omega |
| **Pendientes** (proyectos por hacer: dónde, fecha estimada y lista de materiales con precio y total) — solo jefe eléctrico y admin | nuevo | Omega |

En **Equipos**, cada ficha tiene **Mantención externa**: registra cuando un equipo sale a otro taller (destino,
guía, retorno estimado) y cuando vuelve. La lista de equipos avisa cuántos están fuera y cuáles están atrasados.

El administrador también tiene **RUT Clientes** (Administración): busca por nombre, RUT (con o sin puntos) o comuna.
Al hacer clic en un RUT se abre un mini menú con sus **facturas asociadas**.
**RUT Clientes son los clientes de Omega y Lafken**: el campo *Cliente* de equipos, servicios, sanitización, órdenes,
pendientes y bobinado es un buscador (la lista aparece al escribir; ej.: "a" → ACCOR HOTELS) que busca en los clientes
de la empresa y en RUT Clientes, por nombre o RUT. Al guardar con uno de RUT Clientes, se crea solo como cliente de esa
empresa, con su RUT.
**Subir facturas** (uno o varios PDF de factura electrónica a la vez): Horus lee de cada PDF el RUT, nombre,
dirección, comuna y ciudad del receptor, la fecha y el total (las mismas reglas de `extraer.py`) y suma la factura al
cliente al instante (o crea el cliente si es nuevo; una factura ya registrada no se repite). Solo se guardan los datos,
no el PDF. **Descargar CSV** baja la lista completa en el mismo formato de
`receptores.csv`.
La lista se carga desde un CSV con columnas `rut, nombre, direccion, comuna, ciudad`, `archivo` y
`facturas_asociadas` (varias separadas por ` | `);
si un RUT aparece en varias filas, se juntan sus facturas. Cada carga reemplaza la anterior. El CSV no se sube al repositorio.

Además, el administrador tiene un **Buscador de Excel** (Administración): abre planillas de compras u otras,
las junta y permite filtrar por mes, proveedor, texto o montos, agrupar y sumar. Los archivos se leen solo
en el navegador: **no se suben ni se guardan**.

Es una página web (HTML + JavaScript, sin frameworks) con los datos en **un solo proyecto Supabase**. Se instala como app en el **celular** (Android/iPhone) y en **Windows** (Chrome o Edge → botón “Instalar app”).

Las apps originales quedaron sin cambios en `legado/` como referencia (esa carpeta no se sube a GitHub porque tiene claves).

## Tipos de usuario

| | Administrador | Jefe eléctrico (Omega) / Supervisor (Lafken) | Operario | Cliente | Visitante (sin sesión) |
|---|---|---|---|---|---|
| Empresas | Ambas (clic en el logo, arriba) | Solo la suya | Solo la suya | Solo la de su cliente | — |
| Ver | Todo | Todo lo de su empresa | Todo lo de su empresa | Sus equipos, servicios y sala de bombas (lo que el admin le habilite) | Solo la ficha del QR |
| Crear / editar | Todo | Lo mismo que un operario | Equipos, fotos, productos, movimientos, servicios, mantención externa | Nada | Nada |
| Órdenes de trabajo | Todo | Crear, editar, asignar personal y **verificar** | Iniciar y terminar **las suyas** (con informe) | No | No |
| Borrar | Sí | **No** | **No** | No | No |
| Gestionar clientes, personal, usuarios, módulos ESP32 | Sí | No | No (solo los elige en los formularios) | No | No |
| Bobinado | Sí | Solo con permiso | Solo si el admin le da el permiso (Usuarios → Permisos) | No | No |
| Lista de precios | Ver y cargar/eliminar listas | Solo ver | Solo ver | No | No |
| Sanitización de estanques | Todo | Crear, actualizar y **cambiar el estado** | No (solo registra servicios **SEAP** a clientes con algo coordinado) | No | No |
| Pendientes (proyectos y materiales) | Ver, crear, editar y borrar | Ver, crear y editar | No | No | No |
| Buscador de Excel | Sí | No | No | No | No |
| Historial de cambios | Sí | No | No | No | No |

- **Órdenes de trabajo**: Asignada → En curso → Terminada (quien la hizo escribe el informe) → **Verificada** por el
  jefe o un admin. Si el jefe la devuelve, vuelve a “En curso” con el motivo. Para que alguien pueda iniciar y
  terminar órdenes, su cuenta debe estar vinculada en **Administración → Personal**. Los tipos de orden son
  provisorios: se cambian en `tipos_orden` de `js/config.example.js`. El personal asignado y el jefe pueden
  agregar **fotos y videos** (máx. 50 MB por video) mientras la orden no esté verificada; cada uno puede borrar
  los que subió, y el admin cualquiera.
- **Servicios** (Lafken): cada visita lleva su **IV** (informe de visita, 4 números o más), el **número de visitas**
  del servicio y **una foto** (botón *Tomar foto* para usar la cámara del celular). La **última visita** lleva además el
  **CSI** (5 números): con 1 visita se entregan IV y CSI; con 2, la primera lleva IV y la segunda IV y CSI. Si el servicio tiene más visitas, la tarjeta muestra “Iniciar segunda visita” (tercera…),
  que abre la visita siguiente con el mismo cliente, tipo y personal. Al marcar el tipo **SEAP**, solo se pueden
  elegir clientes que tengan una sanitización en estado **Coordinado** (lo revisa también la base de datos). Se elige
  la sanitización y cuántos estanques se hicieron: se **descuentan de los estanques pendientes**. Si se edita o se
  borra el servicio, la cuenta se corrige sola (mientras la sanitización siga coordinada).
- **Calendario de visitas** (Servicios → Calendario): planes para clientes frecuentes (ej. Santo Tomás, desratización
  cada 2 meses). La próxima visita se calcula desde el último servicio de ese tipo al cliente. Lo arman el supervisor y el
  admin; todos lo ven. La **campanita** de arriba muestra cuántas visitas están atrasadas o vienen en los próximos 7 días.
- **Sanitización de estanques** (Lafken): solo la ven y usan el supervisor y el admin. Tres pestañas. **Cotizado**:
  dónde, cliente y cuántos estanques. Cuando se aprueba, se pasa a **Coordinado**, donde se anota quién va, cuándo y
  cuántos estanques quedan por hacer. Después se pasa a **Finalizado**. El supervisor es un usuario con rol *Jefe* en la empresa Lafken.
- **Pendientes**: cada proyecto tiene lugar, fecha estimada, estado y una lista de materiales (cantidad × precio
  unitario = subtotal). El total se calcula solo; si los precios son netos, se marca “sumar IVA (19%)”.

- **Ficha limitada** (cliente y visitante): empresa, ID, cliente, tipo de motor, voltaje, mantenimiento, estado y fechas. **No** muestra mediciones, notas, proceso, encargados, fotos ni videos. Se cambia en la función `equipo_limitado` de `supabase/schema.sql`.
- Un operario o jefe de Lafken que escanea un QR de Omega ve la ficha limitada.
- Un usuario nuevo queda **“Sin acceso”** hasta que el administrador le asigna un rol.
- **Contraseñas**: cada usuario cambia la suya con el botón de la llave (arriba, junto a su foto). Cuando el admin
  crea una cuenta o le cambia la contraseña desde Administración → Usuarios, la persona debe elegir una nueva al
  entrar (así el admin no queda sabiendo la contraseña de nadie).
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
Vuelve a desplegarla cada vez que cambie `supabase/functions/usuarios/index.ts`.

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

## Impresora de etiquetas del taller (3nStar RPT004)
La RPT004 no imprime bien las imágenes que manda el navegador. En el PC del taller (Linux Mint) corre un
servicio local (`impresora-taller/`) que recibe la etiqueta desde Horus y la imprime con el QR nativo de la
impresora, con el logo de Omega. En celulares y otros PC, el botón usa la impresión normal del navegador.

Requisitos: driver POS-80 instalado y cola de CUPS llamada `POS80`. Instalación del servicio (sin sudo, una vez):
```bash
mkdir -p ~/actualizar && cd ~/actualizar
B=https://daijinn-bkr.github.io/horus/impresora-taller
curl -fsSLO $B/servidor.py
curl -fsSLO $B/logo_etiqueta.bin
curl -fsSLO $B/instalar.sh
bash instalar.sh
```

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
3. **ESP32 real**: en `sala-bombas/firmware/horus_sala_bombas/` copia `config.example.h` como `config.h` (no se sube al repositorio), complétalo (WiFi, URL y clave publishable de Supabase, ID y clave del módulo) y súbelo desde Arduino IDE. `config.h` trae el certificado raíz de Supabase (`CA_RAIZ`): el ESP32 comprueba que habla con Supabase de verdad. Si algún día deja de conectar por el certificado, el comentario en `config.example.h` explica cómo obtener el nuevo. Conexiones y librerías: igual que en `legado/omega-sala-bombas/README.md`. Ahora envía por HTTPS directo a Supabase, así que ya no hace falta un PC servidor encendido.

Umbrales de alarma: se editan por módulo en Administración → Sala de bombas → Editar. Las lecturas se guardan 90 días.
Cada módulo puede enviar como máximo una lectura cada 5 segundos (las más seguidas se ignoran): así, si alguien
obtiene la clave de un módulo, no puede llenar la base de datos.

## Archivos
| Archivo | Para qué |
|---|---|
| `index.html`, `css/horus.css` | Pantalla y estilos |
| `js/app.js` | Sesión, roles, navegación |
| `js/nucleo.js` | Conexión a Supabase, permisos, utilidades |
| `js/equipos.js`, `inventario.js`, `servicios.js`, `sala.js`, `bobinado.js`, `precios.js`, `ordenes.js`, `pendientes.js` | Cada módulo |
| `js/excel.js` | Buscador de Excel (y lectura de Excel para la lista de precios) |
| `js/admin.js` | Usuarios, clientes, personal, módulos ESP32, empresas, historial |
| `js/publico.js` | Ficha limitada (QR) |
| `js/medios.js` | Fotos y videos (Equipos y Órdenes de trabajo) |
| `js/tema.js` | Tema claro/oscuro antes de pintar la página |
| `supabase/schema.sql` | Tablas, permisos por rol, funciones, historial de cambios |
| `supabase/functions/usuarios/` | Crear usuarios y cambiar claves desde la app |
| `supabase/pruebas.sql`, `pruebas_base.sql` | Pruebas de permisos (GitHub Actions las corre en cada cambio de `supabase/`) |
| `migracion/` | Copia los datos de las 3 bases antiguas |
| `sala-bombas/` | Firmware ESP32 y simulador |
| `sw.js`, `manifest.webmanifest`, `icons/` | Instalación como app |

## Seguridad
- **Permisos en la base de datos**: cada tabla tiene Row Level Security. Además, el cliente y el personal de un
  registro deben ser de la misma empresa, y quién creó o subió algo (`creado_por`, `subido_por`, `usuario`…) lo
  fija la base de datos: no se puede falsificar desde la app.
- **Archivos**: los buckets son privados y solo aceptan tipos exactos de fotos (JPG, PNG, WEBP, GIF, HEIC) y videos.
  No aceptan SVG, que puede traer código.
- **Política de seguridad (CSP)** en `index.html`: solo se ejecutan scripts de este sitio y las URL exactas de cada
  librería; nada en línea. Si cambias una librería (en `index.html` o en `SCRIPTS` de `js/nucleo.js`), actualiza
  también su URL en `script-src`. Si Supabase usara un dominio propio (no `*.supabase.co`), hay que agregarlo a la CSP.
- **Doble verificación (recomendado)**: activa MFA con app de códigos (TOTP) en tu cuenta de supabase.com
  (Account → Security), que tiene acceso total a la base de datos. Horus todavía no pide un código al entrar: para
  los administradores de la app eso requiere activar TOTP en Authentication → Multi-Factor **y** agregar la pantalla
  del código en `js/app.js` (no está hecho).
- **Dominio compartido en GitHub Pages**: `daijinn-bkr.github.io/horus` comparte origen (y `localStorage`, donde
  queda guardada la sesión) con cualquier otro repositorio publicado en `daijinn-bkr.github.io` (control-equipos,
  gestor-gastos…). Una falla de seguridad (XSS) en cualquiera de ellos podría robar la sesión de un admin de Horus.
  Para aislarlo, publícalo en un dominio propio: **Settings → Pages → Custom domain** (por ejemplo
  `horus.tuempresa.cl`), crea el registro DNS que indica GitHub y agrega un archivo `CNAME` con ese dominio a lo que
  publica el workflow. Al cambiarlo: agrega el dominio nuevo en `ORIGENES_PERMITIDOS` de
  `impresora-taller/servidor.py`, la URL de instalación de la impresora en este README, y vuelve a imprimir los QR
  (llevan la dirección desde donde se abrió la app).
- **Librerías externas con huella (SRI)**: supabase-js en `index.html` y el resto en `SCRIPTS` de `js/nucleo.js`.
  Si cambias una versión, recalcula la huella:
  `curl -sL URL | openssl dgst -sha384 -binary | openssl base64 -A`
- **QR**: se generan en el navegador; los enlaces de los equipos no se envían a servicios externos.
- **CSV**: los textos que empiezan con `= + - @` se exportan con `'` delante para que Excel no los ejecute.

## Límites del plan gratis de Supabase
500 MB de base de datos y 1 GB de archivos para **todo** el sistema (antes eran 3 proyectos con su propio límite). Las fotos se reducen a ~300 KB; los videos y las lecturas de sala de bombas son lo que más ocupa. Si el proyecto no se usa en 7 días, Supabase lo pausa.

Limpieza a mano (SQL Editor). Horus nunca borra el historial ni los eventos solo; hazlo cuando el espacio lo pida:
```sql
-- Historial de cambios de más de un año
delete from auditoria where fecha < now() - interval '1 year';
-- Filas antiguas del historial creadas por las lecturas del ESP32 (antes de que se dejaran de registrar)
delete from auditoria where tabla = 'dispositivos' and accion = 'UPDATE'
  and (antes - 'ultima_lectura') = (despues - 'ultima_lectura');
-- Eventos de sala de bombas de más de 180 días
delete from eventos_sala where ts < now() - interval '180 days';
```
