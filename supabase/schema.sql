-- =====================================================================
--  HORUS · Sistema unificado Omega Eléctrica + Lafken Austral
--  Pegar completo en Supabase → SQL Editor → Run (se puede ejecutar más de una vez)
--
--  Roles:
--    admin     → acceso total a ambas empresas (crear, editar, borrar, usuarios)
--    operario  → todo dentro de SU empresa, pero sin borrar y sin editar
--                clientes, personal, usuarios ni dispositivos
--    cliente   → solo lectura de SUS equipos, servicios y sala de bombas
--                (según los módulos que el admin le habilite)
--    visitante → sin sesión: solo la ficha pública de un equipo (QR)
--    pendiente → usuario recién creado, sin acceso hasta que el admin lo asigne
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ============ EMPRESAS ============
create table if not exists empresas (
  id       text primary key,                       -- 'omega', 'lafken'
  nombre   text not null,
  modulos  text[] not null default '{}',           -- equipos, inventario, servicios, sala_bombas
  color    text not null default '#1f5fbf'
);
insert into empresas (id, nombre, modulos, color) values
  ('omega',  'Omega Eléctrica', '{equipos,inventario,sala_bombas}', '#1f5fbf'),
  ('lafken', 'Lafken Austral',  '{servicios}',                     '#1f7a5a')
on conflict (id) do nothing;

-- ============ CLIENTES ============
create table if not exists clientes (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  text not null references empresas(id),
  nombre      text not null,
  rut         text,
  contacto    text,
  -- Módulos que el cliente puede ver al iniciar sesión
  modulos     text[] not null default '{equipos,servicios,sala_bombas}',
  creado_en   timestamptz not null default now(),
  unique (empresa_id, nombre)
);
alter table clientes add column if not exists telefono text;

-- RUT chileno con dígito verificador (módulo 11). Acepta "12.345.678-9", "12345678-9" o "123456789".
create or replace function rut_valido(p text) returns boolean language plpgsql immutable as $$
declare
  limpio text := upper(regexp_replace(coalesce(p, ''), '[^0-9kK]', '', 'g'));
  cuerpo text; dv text; suma int := 0; factor int := 2; resto int; esperado text;
begin
  if length(limpio) < 2 or length(limpio) > 9 or limpio !~ '^[0-9]+[0-9K]$' then return false; end if;
  cuerpo := left(limpio, -1);
  dv := right(limpio, 1);
  for i in reverse length(cuerpo)..1 loop
    suma := suma + substr(cuerpo, i, 1)::int * factor;
    factor := case when factor = 7 then 2 else factor + 1 end;
  end loop;
  resto := 11 - (suma % 11);
  esperado := case resto when 11 then '0' when 10 then 'K' else resto::text end;
  return dv = esperado;
end $$;

-- Se valida en la base de datos (además del formulario): nadie puede guardar un RUT o teléfono mal escrito.
-- "not valid" = se exige en todo cliente nuevo o editado, sin bloquear los que ya estaban guardados.
-- Para ver los clientes antiguos con RUT inválido:  select nombre, rut from clientes where not rut_valido(rut);
alter table clientes drop constraint if exists clientes_rut_valido;
alter table clientes add constraint clientes_rut_valido check (rut is null or rut_valido(rut)) not valid;
-- Teléfono chileno normalizado: +56 9 1234 5678 (celular) o +56 2 1234 5678 (fijo)
alter table clientes drop constraint if exists clientes_telefono_valido;
alter table clientes add constraint clientes_telefono_valido check (telefono is null or telefono ~ '^\+56 [2-9] [0-9]{4} [0-9]{4}$') not valid;

-- ============ PERFILES (usuarios) ============
create table if not exists perfiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  nombre      text,
  rol         text not null default 'pendiente'
              check (rol in ('admin','operario','cliente','pendiente')),
  empresa_id  text references empresas(id),
  cliente_id  uuid references clientes(id) on delete set null,
  activo      boolean not null default true,
  creado_en   timestamptz not null default now()
);

-- Coherencia: el operario necesita empresa; el cliente necesita cliente (y hereda su empresa)
create or replace function perfiles_coherencia() returns trigger language plpgsql as $$
begin
  if new.rol = 'cliente' then
    if new.cliente_id is null then raise exception 'Un usuario cliente debe tener un cliente asignado'; end if;
    select empresa_id into new.empresa_id from clientes where id = new.cliente_id;
  elsif new.rol = 'operario' then
    if new.empresa_id is null then raise exception 'Un operario debe tener una empresa asignada'; end if;
    new.cliente_id := null;
  elsif new.rol = 'admin' then
    new.cliente_id := null;
  end if;
  return new;
end $$;
drop trigger if exists perfiles_coherencia on perfiles;
create trigger perfiles_coherencia before insert or update on perfiles
  for each row execute function perfiles_coherencia();

-- Cada usuario nuevo de Supabase Auth queda como "pendiente" (sin acceso)
create or replace function crear_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into perfiles (id, email) values (new.id, new.email) on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function crear_perfil();

insert into perfiles (id, email) select id, email from auth.users on conflict (id) do nothing;
-- Si todavía no hay administrador, el usuario más antiguo pasa a serlo
update perfiles set rol = 'admin'
 where id = (select id from auth.users order by created_at limit 1)
   and not exists (select 1 from perfiles where rol = 'admin');

-- ============ FUNCIONES DE PERMISOS ============
create or replace function mi_rol() returns text
language sql stable security definer set search_path = public as $$
  select rol from perfiles where id = auth.uid() and activo;
$$;
create or replace function mi_empresa() returns text
language sql stable security definer set search_path = public as $$
  select empresa_id from perfiles where id = auth.uid() and activo;
$$;
create or replace function mi_cliente() returns uuid
language sql stable security definer set search_path = public as $$
  select cliente_id from perfiles where id = auth.uid() and activo and rol = 'cliente';
$$;
create or replace function es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(mi_rol() = 'admin', false);
$$;
-- Admin, u operario de esa empresa
create or replace function es_staff(p_empresa text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(mi_rol() = 'admin' or (mi_rol() = 'operario' and mi_empresa() = p_empresa), false);
$$;
-- Cliente con sesión, dueño del registro y con el módulo habilitado
create or replace function cliente_ve(p_cliente uuid, p_modulo text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(p_cliente is not null and mi_cliente() = p_cliente and exists (
    select 1 from clientes c where c.id = p_cliente and p_modulo = any(c.modulos)), false);
$$;

-- ============ PERSONAL (trabajadores que se asignan a servicios) ============
create table if not exists personal (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  text not null references empresas(id),
  nombre      text not null,
  activo      boolean not null default true,
  creado_en   timestamptz not null default now(),
  unique (empresa_id, nombre)
);
-- Vínculo opcional con la cuenta de usuario (una persona = una cuenta). Si se borra la cuenta, la persona queda.
alter table personal add column if not exists usuario_id uuid references perfiles(id) on delete set null;
create unique index if not exists personal_usuario_idx on personal (usuario_id) where usuario_id is not null;

-- ============ EQUIPOS (motores / bombas) ============
create table if not exists equipos (
  id                 text primary key default substr(md5(gen_random_uuid()::text), 1, 8),
  empresa_id         text not null default 'omega' references empresas(id),
  cliente_id         uuid references clientes(id),
  tipo_motor         text,
  tipo_voltaje       text,
  tipo_mantenimiento text,
  encargados         text,
  t_u numeric, t_v numeric, t_w numeric,
  u_v numeric, u_w numeric, v_w numeric,
  u_x numeric, v_y numeric, w_z numeric,
  rodamientos        text,
  sello              text,
  reten              text,
  placa_bornera      text,
  proceso            text,
  notas              text,
  estado             text default 'Pendiente',
  creado_en          timestamptz not null default now(),
  creado_por         uuid default auth.uid() references auth.users(id) on delete set null,
  actualizado_en     timestamptz not null default now()
);
create index if not exists equipos_empresa_idx on equipos (empresa_id, creado_en desc);
create index if not exists equipos_cliente_idx on equipos (cliente_id);

-- Fecha de última modificación automática (si no se indica una a mano, como en la migración)
create or replace function marcar_actualizado() returns trigger language plpgsql as $$
begin
  if new.actualizado_en is not distinct from old.actualizado_en
     and (to_jsonb(new) - 'actualizado_en') is distinct from (to_jsonb(old) - 'actualizado_en') then
    new.actualizado_en := now();
  end if;
  return new;
end $$;
drop trigger if exists equipos_actualizado on equipos;
create trigger equipos_actualizado before update on equipos
  for each row execute function marcar_actualizado();

create table if not exists fotos_equipo (
  id         uuid primary key default gen_random_uuid(),
  equipo_id  text not null references equipos(id) on delete cascade,
  ruta       text not null unique,                 -- <empresa>/<equipo>/<archivo>
  creado_en  timestamptz not null default now(),
  creado_por uuid default auth.uid() references auth.users(id) on delete set null
);
create index if not exists fotos_equipo_idx on fotos_equipo (equipo_id);

create table if not exists videos_equipo (
  id         uuid primary key default gen_random_uuid(),
  equipo_id  text not null references equipos(id) on delete cascade,
  ruta       text not null unique,
  creado_en  timestamptz not null default now(),
  creado_por uuid default auth.uid() references auth.users(id) on delete set null
);
create index if not exists videos_equipo_idx on videos_equipo (equipo_id);

-- ============ INVENTARIO ============
create table if not exists productos (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    text not null default 'omega' references empresas(id),
  codigo        text not null,
  nombre        text not null,
  categoria     text,
  ubicacion     text,
  unidad        text not null default 'un',
  stock         numeric not null default 0 constraint productos_stock_check check (stock >= 0),
  stock_minimo  numeric not null default 0,
  activo        boolean not null default true,
  creado_en     timestamptz not null default now(),
  unique (empresa_id, codigo)
);

create table if not exists movimientos (
  id           bigint generated always as identity primary key,
  producto_id  uuid not null references productos(id) on delete cascade,
  tipo         text not null check (tipo in ('entrada','salida')),
  cantidad     numeric not null check (cantidad > 0),
  motivo       text,
  usuario      text default (auth.jwt() ->> 'email'),
  migrado      boolean not null default false,      -- true solo en la migración: no mueve el stock
  creado_en    timestamptz not null default now()
);
create index if not exists movimientos_producto_idx on movimientos (producto_id, creado_en desc);
create index if not exists movimientos_fecha_idx on movimientos (creado_en desc);

-- El stock cambia solo con movimientos, en la misma transacción
create or replace function aplicar_movimiento() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.migrado then return new; end if;
  if new.tipo = 'entrada' then
    update productos set stock = stock + new.cantidad where id = new.producto_id;
  else
    update productos set stock = stock - new.cantidad where id = new.producto_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_aplicar_movimiento on movimientos;
create trigger trg_aplicar_movimiento after insert on movimientos
  for each row execute function aplicar_movimiento();

-- ============ SERVICIOS ============
create table if not exists servicios (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     text not null references empresas(id),
  cliente_id     uuid not null references clientes(id),
  fecha          date not null default current_date,
  tipos          text[] not null default '{}',
  otros_detalle  text,
  observaciones  text,
  creado_en      timestamptz not null default now()
);
create index if not exists servicios_fecha_idx on servicios (empresa_id, fecha desc);
create index if not exists servicios_cliente_idx on servicios (cliente_id);

create table if not exists servicio_personal (
  servicio_id  uuid not null references servicios(id) on delete cascade,
  personal_id  uuid not null references personal(id),
  primary key (servicio_id, personal_id)
);

-- ============ SALA DE BOMBAS ============
create table if not exists dispositivos (
  id              text primary key,                -- DEVICE_ID del ESP32, ej. 'sala-bombas-01'
  empresa_id      text not null default 'omega' references empresas(id),
  cliente_id      uuid references clientes(id) on delete set null,
  nombre          text not null,
  ubicacion       text,
  activo          boolean not null default true,
  umbrales        jsonb not null default
    '{"temp_min":5,"temp_max":40,"hum_min":20,"hum_max":80,"pres_min":950,"pres_max":1050,"margen_rocio":2,"offline_seg":60}',
  ultima_lectura  timestamptz,
  creado_en       timestamptz not null default now()
);

-- Clave del ESP32 (separada: nadie la puede leer desde la app)
create table if not exists dispositivo_claves (
  dispositivo_id  text primary key references dispositivos(id) on delete cascade,
  clave_hash      text not null
);

create table if not exists lecturas (
  id               bigint generated always as identity primary key,
  dispositivo_id   text not null references dispositivos(id) on delete cascade,
  ts               timestamptz not null default now(),
  motivo           text,
  temperatura      real, humedad real, punto_rocio real,
  presion          real, temperatura_bmp real,
  movimiento       boolean not null default false,
  pir_calentando   boolean not null default false,
  rssi             integer, uptime_s integer,
  errores          text[] not null default '{}'
);
create index if not exists lecturas_disp_ts_idx on lecturas (dispositivo_id, ts desc);

create table if not exists eventos_sala (
  id              bigint generated always as identity primary key,
  dispositivo_id  text not null references dispositivos(id) on delete cascade,
  ts              timestamptz not null default now(),
  tipo            text not null,
  detalle         text
);
create index if not exists eventos_sala_idx on eventos_sala (dispositivo_id, ts desc);

create or replace function puede_ver_dispositivo(p_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select es_staff(d.empresa_id) or cliente_ve(d.cliente_id, 'sala_bombas')
                   from dispositivos d where d.id = p_id), false);
$$;

-- ============ HISTORIAL DE CAMBIOS ============
create table if not exists auditoria (
  id             bigint generated always as identity primary key,
  fecha          timestamptz not null default now(),
  usuario_id     uuid,
  usuario_email  text,
  tabla          text not null,
  accion         text not null check (accion in ('INSERT','UPDATE','DELETE')),
  registro_id    text,
  antes          jsonb,
  despues        jsonb
);
create index if not exists auditoria_fecha_idx on auditoria (fecha desc);

create or replace function registrar_cambio() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_antes jsonb; v_despues jsonb;
begin
  if tg_op = 'INSERT' then v_despues := to_jsonb(new);
  elsif tg_op = 'UPDATE' then v_antes := to_jsonb(old); v_despues := to_jsonb(new);
  else v_antes := to_jsonb(old);
  end if;
  if tg_op = 'UPDATE' and (v_antes - 'actualizado_en') = (v_despues - 'actualizado_en') then return null; end if;
  insert into auditoria (usuario_id, usuario_email, tabla, accion, registro_id, antes, despues)
  values (auth.uid(), (select email from perfiles where id = auth.uid()), tg_table_name, tg_op,
          coalesce(v_despues->>'servicio_id', v_antes->>'servicio_id',
                   v_despues->>'equipo_id', v_antes->>'equipo_id',
                   v_despues->>'id', v_antes->>'id'),
          v_antes, v_despues);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['clientes','perfiles','personal','equipos','fotos_equipo','videos_equipo',
                           'productos','movimientos','servicios','servicio_personal','dispositivos','empresas'] loop
    execute format('drop trigger if exists auditar on %I', t);
    execute format('create trigger auditar after insert or update or delete on %I for each row execute function registrar_cambio()', t);
  end loop;
end $$;

-- ============ SEGURIDAD (Row Level Security) ============
do $$
declare t text;
begin
  foreach t in array array['empresas','clientes','perfiles','personal','equipos','fotos_equipo','videos_equipo',
                           'productos','movimientos','servicios','servicio_personal','dispositivos',
                           'dispositivo_claves','lecturas','eventos_sala','auditoria'] loop
    execute format('alter table %I enable row level security', t);
    -- borra las políticas anteriores para poder re-ejecutar el script
    execute (select coalesce(string_agg(format('drop policy if exists %I on %I;', policyname, t), ' '), 'select 1')
               from pg_policies where schemaname = 'public' and tablename = t);
  end loop;
end $$;

-- Empresas: todos los usuarios con sesión las ven; solo admin las cambia
create policy "empresas_ver"    on empresas for select to authenticated using (true);
create policy "empresas_admin"  on empresas for update to authenticated using (es_admin()) with check (es_admin());

-- Clientes: staff de la empresa (o el propio cliente) ve; solo admin crea/edita/borra
create policy "clientes_ver"    on clientes for select to authenticated using (es_staff(empresa_id) or id = mi_cliente());
create policy "clientes_crear"  on clientes for insert to authenticated with check (es_admin());
create policy "clientes_editar" on clientes for update to authenticated using (es_admin()) with check (es_admin());
create policy "clientes_borrar" on clientes for delete to authenticated using (es_admin());

-- Perfiles: cada uno ve el suyo; admin ve y edita todos (menos su propio rol)
create policy "perfiles_ver"    on perfiles for select to authenticated using (id = auth.uid() or es_admin());
create policy "perfiles_editar" on perfiles for update to authenticated
  using (es_admin() and id <> auth.uid()) with check (es_admin() and id <> auth.uid());

-- Personal: staff ve; solo admin gestiona
create policy "personal_ver"    on personal for select to authenticated using (es_staff(empresa_id));
create policy "personal_crear"  on personal for insert to authenticated with check (es_admin());
create policy "personal_editar" on personal for update to authenticated using (es_admin()) with check (es_admin());
create policy "personal_borrar" on personal for delete to authenticated using (es_admin());

-- Equipos: staff ve/crea/edita; solo admin borra. Los clientes y visitantes usan
-- las funciones mis_equipos() / ficha_publica() que devuelven solo los datos limitados.
create policy "equipos_ver"     on equipos for select to authenticated using (es_staff(empresa_id));
create policy "equipos_crear"   on equipos for insert to authenticated with check (es_staff(empresa_id));
create policy "equipos_editar"  on equipos for update to authenticated using (es_staff(empresa_id)) with check (es_staff(empresa_id));
create policy "equipos_borrar"  on equipos for delete to authenticated using (es_admin());

create policy "fotos_ver"     on fotos_equipo for select to authenticated
  using (exists (select 1 from equipos e where e.id = equipo_id));
create policy "fotos_crear"   on fotos_equipo for insert to authenticated
  with check (exists (select 1 from equipos e where e.id = equipo_id));
create policy "fotos_borrar"  on fotos_equipo for delete to authenticated using (es_admin());
create policy "videos_ver"    on videos_equipo for select to authenticated
  using (exists (select 1 from equipos e where e.id = equipo_id));
create policy "videos_crear"  on videos_equipo for insert to authenticated
  with check (exists (select 1 from equipos e where e.id = equipo_id));
create policy "videos_borrar" on videos_equipo for delete to authenticated using (es_admin());

-- Inventario: solo staff; el historial de movimientos nunca se borra ni se edita
create policy "productos_ver"    on productos for select to authenticated using (es_staff(empresa_id));
create policy "productos_crear"  on productos for insert to authenticated with check (es_staff(empresa_id));
create policy "productos_editar" on productos for update to authenticated using (es_staff(empresa_id)) with check (es_staff(empresa_id));
create policy "productos_borrar" on productos for delete to authenticated using (es_admin());
create policy "movimientos_ver"   on movimientos for select to authenticated
  using (exists (select 1 from productos p where p.id = producto_id));
create policy "movimientos_crear" on movimientos for insert to authenticated
  with check (not migrado and exists (select 1 from productos p where p.id = producto_id));

-- Servicios: staff ve/crea/edita; admin borra. Clientes usan mis_servicios().
create policy "servicios_ver"    on servicios for select to authenticated using (es_staff(empresa_id));
create policy "servicios_crear"  on servicios for insert to authenticated with check (es_staff(empresa_id));
create policy "servicios_editar" on servicios for update to authenticated using (es_staff(empresa_id)) with check (es_staff(empresa_id));
create policy "servicios_borrar" on servicios for delete to authenticated using (es_admin());
create policy "sp_ver"    on servicio_personal for select to authenticated
  using (exists (select 1 from servicios s where s.id = servicio_id));
create policy "sp_crear"  on servicio_personal for insert to authenticated
  with check (exists (select 1 from servicios s where s.id = servicio_id));
-- quitar a alguien de un servicio es parte de editarlo (como en la app anterior)
create policy "sp_quitar" on servicio_personal for delete to authenticated
  using (exists (select 1 from servicios s where s.id = servicio_id));

-- Sala de bombas: staff y el cliente dueño (con el módulo) ven; solo admin gestiona dispositivos
create policy "disp_ver"    on dispositivos for select to authenticated
  using (es_staff(empresa_id) or cliente_ve(cliente_id, 'sala_bombas'));
create policy "disp_crear"  on dispositivos for insert to authenticated with check (es_admin());
create policy "disp_editar" on dispositivos for update to authenticated using (es_admin()) with check (es_admin());
create policy "disp_borrar" on dispositivos for delete to authenticated using (es_admin());
-- dispositivo_claves: sin políticas → nadie la lee ni escribe desde la app
create policy "lecturas_ver" on lecturas     for select to authenticated using (puede_ver_dispositivo(dispositivo_id));
create policy "eventos_ver"  on eventos_sala for select to authenticated using (puede_ver_dispositivo(dispositivo_id));

-- Historial de cambios: solo admin lo ve; nadie lo puede escribir ni borrar
create policy "auditoria_ver" on auditoria for select to authenticated using (es_admin());

-- ============ VISTA LIMITADA DE EQUIPOS (clientes y visitantes) ============
create or replace function equipo_limitado(e equipos) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', e.id,
    'empresa', (select nombre from empresas where id = e.empresa_id),
    'cliente', (select nombre from clientes where id = e.cliente_id),
    'tipo_motor', e.tipo_motor,
    'tipo_voltaje', e.tipo_voltaje,
    'tipo_mantenimiento', e.tipo_mantenimiento,
    'estado', e.estado,
    'creado_en', e.creado_en,
    'actualizado_en', e.actualizado_en);
$$;
revoke all on function equipo_limitado(equipos) from public, anon;

-- Ficha pública del QR: cualquiera con el enlace (con o sin sesión)
create or replace function ficha_publica(p_id text) returns jsonb
language sql stable security definer set search_path = public as $$
  select equipo_limitado(e) from equipos e where e.id = p_id;
$$;
grant execute on function ficha_publica(text) to anon, authenticated;

-- Equipos del cliente con sesión
create or replace function mis_equipos() returns setof jsonb
language sql stable security definer set search_path = public as $$
  select equipo_limitado(e) from equipos e
   where cliente_ve(e.cliente_id, 'equipos') order by e.creado_en desc;
$$;

-- Servicios del cliente con sesión
create or replace function mis_servicios()
returns table (id uuid, fecha date, tipos text[], otros_detalle text, observaciones text, personal text[])
language sql stable security definer set search_path = public as $$
  select s.id, s.fecha, s.tipos, s.otros_detalle, s.observaciones,
         array(select p.nombre from servicio_personal sp join personal p on p.id = sp.personal_id
                where sp.servicio_id = s.id order by p.nombre)
    from servicios s
   where cliente_ve(s.cliente_id, 'servicios')
   order by s.fecha desc, s.creado_en desc;
$$;

-- ============ SALA DE BOMBAS: recepción desde el ESP32 ============
create or replace function num_o_null(v jsonb) returns real
language sql immutable as $$
  select case when jsonb_typeof(v) = 'number' then (v #>> '{}')::real end;
$$;

create or replace function registrar_evento_sala(p_disp text, p_tipo text, p_detalle text, p_cooldown_seg int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from eventos_sala where dispositivo_id = p_disp and tipo = p_tipo
              and ts > now() - make_interval(secs => p_cooldown_seg)) then return; end if;
  insert into eventos_sala (dispositivo_id, tipo, detalle) values (p_disp, p_tipo, p_detalle);
end $$;

-- El ESP32 (o el simulador) llama: POST /rest/v1/rpc/registrar_lectura
--   { "p_dispositivo": "sala-bombas-01", "p_clave": "...", "p_datos": { temperatura, humedad, ... } }
create or replace function registrar_lectura(p_dispositivo text, p_clave text, p_datos jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  d dispositivos; h text; l lecturas; u jsonb;
begin
  select * into d from dispositivos where id = p_dispositivo and activo;
  select clave_hash into h from dispositivo_claves where dispositivo_id = p_dispositivo;
  if d.id is null or h is null or crypt(coalesce(p_clave, ''), h) <> h then
    raise exception 'Dispositivo o clave inválidos' using errcode = '28000';
  end if;

  insert into lecturas (dispositivo_id, motivo, temperatura, humedad, punto_rocio, presion, temperatura_bmp,
                        movimiento, pir_calentando, rssi, uptime_s, errores)
  values (d.id, left(coalesce(p_datos->>'motivo', 'periodico'), 20),
          num_o_null(p_datos->'temperatura'), num_o_null(p_datos->'humedad'), num_o_null(p_datos->'punto_rocio'),
          num_o_null(p_datos->'presion'), num_o_null(p_datos->'temperatura_bmp'),
          coalesce((p_datos->>'movimiento')::boolean, false), coalesce((p_datos->>'pir_calentando')::boolean, false),
          num_o_null(p_datos->'rssi')::int, num_o_null(p_datos->'uptime_s')::int,
          coalesce(array(select left(x, 40) from jsonb_array_elements_text(
                    case when jsonb_typeof(p_datos->'errores') = 'array' then p_datos->'errores' else '[]' end) x limit 5), '{}'))
  returning * into l;

  update dispositivos set ultima_lectura = l.ts where id = d.id;

  u := d.umbrales;
  if l.movimiento then perform registrar_evento_sala(d.id, 'movimiento', 'Movimiento detectado en la sala', 60); end if;
  if l.temperatura > (u->>'temp_max')::real then perform registrar_evento_sala(d.id, 'temp_alta', format('Temperatura alta: %s °C', l.temperatura), 300); end if;
  if l.temperatura < (u->>'temp_min')::real then perform registrar_evento_sala(d.id, 'temp_baja', format('Temperatura baja: %s °C', l.temperatura), 300); end if;
  if l.humedad > (u->>'hum_max')::real then perform registrar_evento_sala(d.id, 'hum_alta', format('Humedad alta: %s %%', l.humedad), 300); end if;
  if l.humedad < (u->>'hum_min')::real then perform registrar_evento_sala(d.id, 'hum_baja', format('Humedad baja: %s %%', l.humedad), 300); end if;
  if l.presion > (u->>'pres_max')::real or l.presion < (u->>'pres_min')::real then
    perform registrar_evento_sala(d.id, 'presion_fuera', format('Presión fuera de rango: %s hPa', l.presion), 300); end if;
  if l.temperatura - l.punto_rocio < (u->>'margen_rocio')::real then
    perform registrar_evento_sala(d.id, 'condensacion', format('Riesgo de condensación (T %s °C, rocío %s °C)', l.temperatura, l.punto_rocio), 300); end if;
  if cardinality(l.errores) > 0 then
    perform registrar_evento_sala(d.id, 'falla_sensor', 'Sensor sin respuesta: ' || array_to_string(l.errores, ', '), 300); end if;

  -- Limpieza ocasional: conserva 90 días de lecturas
  if random() < 0.002 then delete from lecturas where ts < now() - interval '90 days'; end if;

  return jsonb_build_object('ok', true);
end $$;
revoke all on function registrar_lectura(text, text, jsonb) from public;
grant execute on function registrar_lectura(text, text, jsonb) to anon, authenticated;
revoke all on function registrar_evento_sala(text, text, text, int) from public, anon, authenticated;

-- Admin fija la clave del ESP32 (se guarda cifrada)
create or replace function fijar_clave_dispositivo(p_dispositivo text, p_clave text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not es_admin() then raise exception 'Solo el administrador puede cambiar la clave'; end if;
  if length(coalesce(p_clave, '')) < 8 then raise exception 'La clave debe tener al menos 8 caracteres'; end if;
  insert into dispositivo_claves (dispositivo_id, clave_hash) values (p_dispositivo, crypt(p_clave, gen_salt('bf')))
  on conflict (dispositivo_id) do update set clave_hash = excluded.clave_hash;
end $$;
revoke all on function fijar_clave_dispositivo(text, text) from public, anon;
grant execute on function fijar_clave_dispositivo(text, text) to authenticated;

-- Historial promediado para los gráficos (~300 puntos). Respeta los permisos de lecturas.
create or replace function historial_sala(p_dispositivo text, p_horas int)
returns table (ts timestamptz, temperatura real, humedad real, presion real, punto_rocio real, movimiento boolean)
language sql stable as $$
  with p as (select greatest(least(coalesce(p_horas, 24), 24 * 31), 1) as horas),
       b as (select greatest(floor(horas * 3600 / 300.0), 10)::int as seg, horas from p)
  select to_timestamp(floor(extract(epoch from l.ts) / b.seg) * b.seg) as ts,
         round(avg(l.temperatura)::numeric, 1)::real, round(avg(l.humedad)::numeric, 1)::real,
         round(avg(l.presion)::numeric, 1)::real, round(avg(l.punto_rocio)::numeric, 1)::real,
         bool_or(l.movimiento)
    from lecturas l, b
   where l.dispositivo_id = p_dispositivo and l.ts >= now() - make_interval(hours => b.horas)
   group by 1 order by 1;
$$;

-- ============ ARCHIVOS (fotos y videos de equipos) ============
-- Bucket privado; 50 MB por archivo. Ruta: <empresa>/<equipo>/<archivo>
insert into storage.buckets (id, name, public, file_size_limit)
values ('equipos', 'equipos', false, 52428800)
on conflict (id) do nothing;

drop policy if exists "horus_archivos_leer"   on storage.objects;
drop policy if exists "horus_archivos_subir"  on storage.objects;
drop policy if exists "horus_archivos_borrar" on storage.objects;
create policy "horus_archivos_leer"   on storage.objects for select to authenticated
  using (bucket_id = 'equipos' and es_staff((storage.foldername(name))[1]));
create policy "horus_archivos_subir"  on storage.objects for insert to authenticated
  with check (bucket_id = 'equipos' and es_staff((storage.foldername(name))[1]));
create policy "horus_archivos_borrar" on storage.objects for delete to authenticated
  using (bucket_id = 'equipos' and es_admin());

-- ============ TIEMPO REAL ============
do $$
declare t text;
begin
  foreach t in array array['equipos','productos','movimientos','servicios','lecturas','eventos_sala'] loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- =====================================================================
-- ============ PERMISOS ESPECIALES, BOBINADO Y LISTA DE PRECIOS ============
-- =====================================================================

-- Permisos extra por usuario (los asigna el admin). Hoy: 'bobinado'.
alter table perfiles add column if not exists permisos text[] not null default '{}';

-- Admin siempre; operario solo si el admin le dio el permiso
create or replace function tiene_permiso(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select rol = 'admin' or (rol = 'operario' and p = any(permisos))
                     from perfiles where id = auth.uid() and activo), false);
$$;

-- Módulos nuevos para Omega (solo se agregan si la empresa todavía no tiene ninguno de los dos)
update empresas set modulos = modulos || '{bobinado,precios}'::text[]
 where id = 'omega' and not (modulos && '{bobinado,precios}'::text[]);

-- ---------- BOBINADO: registro de motores rebobinados ----------
create table if not exists bobinados (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        text not null references empresas(id),
  fecha             date not null default current_date,
  estado            text not null default 'Recibido',
  cliente_id        uuid references clientes(id) on delete set null,
  -- Datos de placa
  marca             text,
  modelo            text,
  serie             text,
  potencia          numeric,
  potencia_unidad   text not null default 'kW' check (potencia_unidad in ('kW','HP')),
  rpm               integer,
  voltaje           text,
  corriente         text,
  frecuencia        integer default 50,
  fases             integer default 3 check (fases in (1, 3)),
  -- Datos del bobinado
  ranuras           integer,
  polos             integer,
  tipo_bobinado     text,
  paso              text,
  vueltas           text,
  calibre           text,
  alambres_paralelo integer,
  conexion          text,
  peso_cobre        numeric,
  observaciones     text,
  creado_por        uuid default auth.uid() references perfiles(id) on delete set null,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now()
);
create index if not exists bobinados_empresa_fecha_idx on bobinados (empresa_id, fecha desc);

drop trigger if exists marcar_actualizado on bobinados;
create trigger marcar_actualizado before update on bobinados
  for each row execute function marcar_actualizado();
drop trigger if exists auditar on bobinados;
create trigger auditar after insert or update or delete on bobinados
  for each row execute function registrar_cambio();

-- ---------- LISTA DE PRECIOS: una por mes; nadie puede modificar sus productos ----------
create table if not exists listas_precios (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   text not null references empresas(id),
  periodo      date not null,                 -- primer día del mes
  nombre       text not null,
  archivo      text,
  total        integer not null default 0,
  tipos        text[] not null default '{}',
  cargado_por  uuid default auth.uid() references perfiles(id) on delete set null,
  cargado_en   timestamptz not null default now(),
  unique (empresa_id, periodo)
);
create table if not exists precios (
  id           bigint generated always as identity primary key,
  lista_id     uuid not null references listas_precios(id) on delete cascade,
  codigo       text,
  tipo         text,
  descripcion  text not null,
  unidad       text,
  precio       numeric
);
create index if not exists precios_lista_idx  on precios (lista_id, descripcion);
create index if not exists precios_codigo_idx on precios (lista_id, codigo);

drop trigger if exists auditar on listas_precios;
create trigger auditar after insert or delete on listas_precios
  for each row execute function registrar_cambio();

-- Texto sin tildes y en minúsculas, para que "valvula" encuentre "VÁLVULA"
create or replace function horus_normal(t text) returns text language sql immutable as $$
  select translate(lower(coalesce(t, '')), 'áéíóúüñ', 'aeiouun');
$$;

-- Carga una lista completa de una vez (solo admin). Si algo falla, no queda nada a medias.
create or replace function cargar_lista_precios(p_empresa text, p_periodo date, p_nombre text,
                                                p_archivo text, p_items jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_periodo date := date_trunc('month', p_periodo)::date;
begin
  if not es_admin() then
    raise exception 'Solo un administrador puede cargar listas de precios' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La lista no tiene productos';
  end if;
  if exists (select 1 from listas_precios where empresa_id = p_empresa and periodo = v_periodo) then
    raise exception 'Ya existe una lista de precios de ese mes. Elimínala primero si quieres reemplazarla.'
      using errcode = 'P0001';
  end if;
  insert into listas_precios (empresa_id, periodo, nombre, archivo)
  values (p_empresa, v_periodo, coalesce(nullif(trim(p_nombre), ''), to_char(v_periodo, 'MM/YYYY')), p_archivo)
  returning id into v_id;
  insert into precios (lista_id, codigo, tipo, descripcion, unidad, precio)
  select v_id, nullif(trim(i->>'codigo'), ''), nullif(trim(i->>'tipo'), ''), trim(i->>'descripcion'),
         nullif(trim(i->>'unidad'), ''), (nullif(trim(i->>'precio'), ''))::numeric
    from jsonb_array_elements(p_items) i
   where nullif(trim(i->>'descripcion'), '') is not null;
  update listas_precios l set
    total = (select count(*) from precios where lista_id = v_id),
    tipos = coalesce((select array_agg(distinct tipo order by tipo) from precios
                       where lista_id = v_id and tipo is not null), '{}')
   where l.id = v_id;
  return v_id;
end $$;

-- Búsqueda: cada palabra debe aparecer en el código o la descripción.
-- Devuelve también el precio del mismo código en la lista del mes anterior (para ver si subió).
create or replace function buscar_precios(p_lista uuid, p_texto text default '', p_tipo text default null,
                                          p_orden text default 'descripcion', p_limite int default 100,
                                          p_desde int default 0)
returns table (codigo text, tipo text, descripcion text, unidad text, precio numeric,
               precio_anterior numeric, total bigint)
language sql stable set search_path = public as $$
  with l as (select * from listas_precios where id = p_lista),
       ant as (select a.id from listas_precios a, l
                where a.empresa_id = l.empresa_id and a.periodo < l.periodo
                order by a.periodo desc limit 1),
       palabras as (select w from unnest(string_to_array(horus_normal(trim(coalesce(p_texto, ''))), ' ')) w
                     where w <> ''),
       r as (
         select p.* from precios p
          where p.lista_id = p_lista
            and (coalesce(p_tipo, '') = '' or p.tipo = p_tipo)
            and not exists (select 1 from palabras
                             where horus_normal(coalesce(p.codigo, '') || ' ' || p.descripcion) not like '%' || w || '%'))
  select r.codigo, r.tipo, r.descripcion, r.unidad, r.precio,
         (select x.precio from precios x, ant where x.lista_id = ant.id and x.codigo = r.codigo limit 1),
         count(*) over ()
    from r
   order by case when p_orden = 'precio_asc'  then r.precio end asc nulls last,
            case when p_orden = 'precio_desc' then r.precio end desc nulls last,
            r.descripcion
   limit least(greatest(coalesce(p_limite, 100), 1), 500) offset greatest(coalesce(p_desde, 0), 0);
$$;

-- ---------- Seguridad ----------
do $$
declare t text;
begin
  foreach t in array array['bobinados','listas_precios','precios'] loop
    execute format('alter table %I enable row level security', t);
    execute (select coalesce(string_agg(format('drop policy if exists %I on %I;', policyname, t), ' '), 'select 1')
               from pg_policies where schemaname = 'public' and tablename = t);
  end loop;
end $$;

-- Bobinado: admin, u operario de la empresa con el permiso 'bobinado'. Solo admin borra.
create policy "bobinados_ver"    on bobinados for select to authenticated
  using (es_staff(empresa_id) and tiene_permiso('bobinado'));
create policy "bobinados_crear"  on bobinados for insert to authenticated
  with check (es_staff(empresa_id) and tiene_permiso('bobinado'));
create policy "bobinados_editar" on bobinados for update to authenticated
  using (es_staff(empresa_id) and tiene_permiso('bobinado'))
  with check (es_staff(empresa_id) and tiene_permiso('bobinado'));
create policy "bobinados_borrar" on bobinados for delete to authenticated using (es_admin());

-- Lista de precios: el personal de la empresa la ve. Nadie edita productos: solo se cargan
-- con cargar_lista_precios() (admin), y el admin puede eliminar una lista mensual completa.
create policy "listas_ver"    on listas_precios for select to authenticated using (es_staff(empresa_id));
create policy "listas_borrar" on listas_precios for delete to authenticated using (es_admin());
create policy "precios_ver"   on precios for select to authenticated
  using (exists (select 1 from listas_precios l where l.id = lista_id));

revoke execute on function cargar_lista_precios(text, date, text, text, jsonb) from anon, public;
grant  execute on function cargar_lista_precios(text, date, text, text, jsonb) to authenticated;
