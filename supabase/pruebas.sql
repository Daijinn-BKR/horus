-- =====================================================================
--  HORUS · Pruebas de permisos y de los arreglos de auditoría
--  Se ejecutan en GitHub Actions (.github/workflows/pruebas.yml) sobre un Postgres vacío:
--    pruebas_base.sql → schema.sql (dos veces) → este archivo.
--  Todo corre en una transacción que se deshace al final. Si una prueba falla, lanza un error.
--  NO se pega en Supabase.
-- =====================================================================
\set ON_ERROR_STOP on
begin;

-- ---------- Datos de prueba (sin sesión, como el SQL Editor) ----------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@prueba.cl'),
  ('00000000-0000-0000-0000-00000000000b', 'lafken@prueba.cl'),
  ('00000000-0000-0000-0000-00000000000c', 'omega@prueba.cl'),
  ('00000000-0000-0000-0000-00000000000d', 'cliente@prueba.cl');
insert into clientes (id, empresa_id, nombre) values
  ('00000000-0000-0000-0000-0000000000c1', 'omega',  'Cliente Omega'),
  ('00000000-0000-0000-0000-0000000000c2', 'omega',  'Otro cliente Omega'),
  ('00000000-0000-0000-0000-0000000000c3', 'lafken', 'Cliente Lafken');
update perfiles set rol = 'admin' where id = '00000000-0000-0000-0000-00000000000a';
update perfiles set rol = 'operario', empresa_id = 'lafken' where id = '00000000-0000-0000-0000-00000000000b';
update perfiles set rol = 'operario', empresa_id = 'omega'  where id = '00000000-0000-0000-0000-00000000000c';
update perfiles set rol = 'cliente', cliente_id = '00000000-0000-0000-0000-0000000000c1' where id = '00000000-0000-0000-0000-00000000000d';

insert into equipos (id, empresa_id, cliente_id, tipo_motor) values
  ('eqomega1', 'omega', '00000000-0000-0000-0000-0000000000c1', 'Bomba del cliente'),
  ('eqomega2', 'omega', '00000000-0000-0000-0000-0000000000c2', 'Bomba de otro cliente');
insert into productos (id, empresa_id, codigo, nombre, stock) values
  ('00000000-0000-0000-0000-0000000000f1', 'omega', 'P1', 'Rodamiento', 10);
insert into personal (id, empresa_id, nombre) values
  ('00000000-0000-0000-0000-0000000000e1', 'lafken', 'Ana'),
  ('00000000-0000-0000-0000-0000000000e2', 'lafken', 'Beto'),
  ('00000000-0000-0000-0000-0000000000e3', 'lafken', 'Carla');
insert into dispositivos (id, empresa_id, cliente_id, nombre) values
  ('disp-cliente', 'omega', '00000000-0000-0000-0000-0000000000c1', 'Sala del cliente'),
  ('disp-otro',    'omega', null,                                    'Sala sin cliente');
insert into dispositivo_claves (dispositivo_id, clave_hash) values
  ('disp-cliente', extensions.crypt('clave-de-prueba', extensions.gen_salt('bf'))),
  ('disp-otro',    extensions.crypt('clave-de-prueba', extensions.gen_salt('bf')));
insert into lecturas (dispositivo_id, temperatura) values ('disp-cliente', 20), ('disp-otro', 21);

-- ---------- Operario de Lafken: no ve nada de Omega ----------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
set local role authenticated;
do $$ begin
  if exists (select 1 from equipos)   then raise exception 'FALLA: operario de Lafken ve equipos de Omega'; end if;
  if exists (select 1 from productos) then raise exception 'FALLA: operario de Lafken ve productos de Omega'; end if;
  if exists (select 1 from lecturas)  then raise exception 'FALLA: operario de Lafken ve lecturas de Omega'; end if;
  raise notice 'OK: operario de Lafken no ve datos de Omega';
end $$;
reset role;

-- ---------- Operario de Omega: no borra equipos ni cambia su rol ----------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
set local role authenticated;
do $$ declare n int; begin
  delete from equipos where id = 'eqomega1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALLA: un operario pudo borrar un equipo'; end if;
  update perfiles set rol = 'admin' where id = auth.uid();
  if mi_rol() <> 'operario' then raise exception 'FALLA: un operario pudo cambiar su propio rol'; end if;
  raise notice 'OK: operario no borra equipos ni cambia su rol';
end $$;

-- Punto 4: el stock no se cambia directo, sí con movimientos
do $$ declare ok boolean := false; begin
  begin
    update productos set stock = 9999 where id = '00000000-0000-0000-0000-0000000000f1';
  exception when others then ok := sqlerrm like '%solo cambia con entradas y salidas%';
  end;
  if not ok then raise exception 'FALLA: se pudo cambiar el stock sin movimiento'; end if;
  insert into movimientos (producto_id, tipo, cantidad) values ('00000000-0000-0000-0000-0000000000f1', 'salida', 4);
  if (select stock from productos where id = '00000000-0000-0000-0000-0000000000f1') <> 6 then
    raise exception 'FALLA: una salida de 4 no dejó el stock en 6';
  end if;
  -- editar otros datos del producto sigue funcionando
  update productos set nombre = 'Rodamiento 6204' where id = '00000000-0000-0000-0000-0000000000f1';
  raise notice 'OK: stock solo con movimientos';
end $$;

-- Punto 10: el ID del equipo nuevo lo decide la base de datos
do $$ declare v text; begin
  insert into equipos (id, empresa_id, cliente_id) values ('elegido', 'omega', '00000000-0000-0000-0000-0000000000c2')
  returning id into v;
  if v = 'elegido' or length(v) <> 10 then raise exception 'FALLA: el ID del equipo se pudo elegir (%)', v; end if;
  raise notice 'OK: ID de equipo nuevo = % (10 caracteres)', v;
end $$;
reset role;

-- ---------- Cliente: solo sus equipos y su sala de bombas ----------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', true);
set local role authenticated;
do $$ begin
  if (select array_agg(x->>'id') from mis_equipos() x) is distinct from array['eqomega1'] then
    raise exception 'FALLA: mis_equipos() no devuelve solo el equipo del cliente';
  end if;
  if exists (select 1 from equipos) then raise exception 'FALLA: el cliente lee la tabla equipos completa'; end if;
  if (select array_agg(distinct dispositivo_id) from lecturas) is distinct from array['disp-cliente'] then
    raise exception 'FALLA: el cliente no ve solo las lecturas de su dispositivo';
  end if;
  raise notice 'OK: el cliente ve solo lo suyo';
end $$;
reset role;

-- Admin ve todas las lecturas
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
do $$ begin
  if (select count(distinct dispositivo_id) from lecturas) <> 2 then raise exception 'FALLA: el admin no ve todas las lecturas'; end if;
  raise notice 'OK: el admin ve todas las lecturas';
end $$;
reset role;

-- ---------- Punto 1: las lecturas del ESP32 no llenan el historial ----------
select set_config('request.jwt.claim.sub', '', true);
do $$ declare antes bigint := (select count(*) from auditoria); r jsonb; begin
  for i in 1..5 loop
    update dispositivos set ultima_lectura = now() - interval '1 minute' where id = 'disp-otro';  -- separa las llamadas
    r := registrar_lectura('disp-otro', 'clave-de-prueba', '{"temperatura": 22}');
    if not (r->>'ok')::boolean then raise exception 'FALLA: lectura % rechazada: %', i, r; end if;
  end loop;
  if (select count(*) from auditoria) <> antes then raise exception 'FALLA: las lecturas agregaron filas al historial'; end if;
  raise notice 'OK: 5 lecturas, 0 filas nuevas en el historial';
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
do $$ declare antes bigint; begin
  reset role;
  antes := (select count(*) from auditoria);
  set local role authenticated;
  update dispositivos set nombre = 'Sala renombrada' where id = 'disp-otro';
  reset role;
  if (select count(*) from auditoria) <> antes + 1 then raise exception 'FALLA: editar un dispositivo no quedó en el historial'; end if;
  raise notice 'OK: editar un dispositivo sí queda en el historial';
end $$;
reset role;

-- ---------- Punto 6: máximo una lectura cada 5 s ----------
select set_config('request.jwt.claim.sub', '', true);
set local role anon;
do $$ declare r1 jsonb; r2 jsonb; begin
  r1 := registrar_lectura('disp-cliente', 'clave-de-prueba', '{"temperatura": 23}');
  r2 := registrar_lectura('disp-cliente', 'clave-de-prueba', '{"temperatura": 23}');
  if not (r1->>'ok')::boolean then raise exception 'FALLA: la primera lectura fue rechazada: %', r1; end if;
  if r2 is distinct from '{"ok": false, "motivo": "muy_seguido"}'::jsonb then
    raise exception 'FALLA: la segunda lectura seguida no se rechazó: %', r2;
  end if;
  raise notice 'OK: la segunda lectura en menos de 5 s se rechaza';
end $$;
reset role;

-- ---------- Punto 8: srv_guardar guarda el servicio y su personal ----------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
set local role authenticated;
do $$ declare v uuid; begin
  v := srv_guardar(null, '{"empresa_id":"lafken","cliente_id":"00000000-0000-0000-0000-0000000000c3","fecha":"2026-01-10",
                          "tipos":["Desratización"],"iv":"1234","visitas":2}',
                   array['00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000e2']::uuid[]);
  perform srv_guardar(v, '{"cliente_id":"00000000-0000-0000-0000-0000000000c3","fecha":"2026-01-11",
                          "tipos":["Desratización"],"iv":"12345","visitas":2}',
                      array['00000000-0000-0000-0000-0000000000e2','00000000-0000-0000-0000-0000000000e3']::uuid[]);
  if (select array_agg(personal_id order by personal_id) from servicio_personal where servicio_id = v)
     is distinct from array['00000000-0000-0000-0000-0000000000e2','00000000-0000-0000-0000-0000000000e3']::uuid[] then
    raise exception 'FALLA: srv_guardar no sincronizó el personal';
  end if;
  if (select iv from servicios where id = v) <> '12345' then raise exception 'FALLA: srv_guardar no actualizó el servicio'; end if;
  -- Un IV inválido no deja nada a medias
  begin
    perform srv_guardar(null, '{"empresa_id":"lafken","cliente_id":"00000000-0000-0000-0000-0000000000c3","fecha":"2026-01-12","iv":"12"}',
                        array['00000000-0000-0000-0000-0000000000e1']::uuid[]);
    raise exception 'FALLA: srv_guardar aceptó un IV inválido';
  exception when check_violation then null;
  end;
  raise notice 'OK: srv_guardar';
end $$;

-- ---------- Punto 9: la foto de un servicio registrado no se borra (salvo admin) ----------
do $$ declare v uuid := (select id from servicios limit 1); n int; begin
  insert into storage.objects (bucket_id, name) values ('servicios', 'lafken/foto1.jpg'), ('servicios', 'lafken/foto2.jpg');
  update servicios set foto = 'lafken/foto1.jpg' where id = v;
  delete from storage.objects where bucket_id = 'servicios' and name = 'lafken/foto1.jpg';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALLA: el operario borró la foto de un servicio registrado'; end if;
  -- Al reemplazarla, la anterior ya no está registrada y sí se puede borrar
  update servicios set foto = 'lafken/foto2.jpg' where id = v;
  delete from storage.objects where bucket_id = 'servicios' and name = 'lafken/foto1.jpg';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FALLA: no se pudo borrar la foto reemplazada'; end if;
  raise notice 'OK: fotos de servicios protegidas';
end $$;

-- ---------- Punto 5: clave_cambiada() solo toca la fila propia ----------
reset role;
update perfiles set debe_cambiar_clave = true
 where id in ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000c');
set local role authenticated;
do $$ begin
  perform clave_cambiada();
  reset role;
  if (select debe_cambiar_clave from perfiles where id = '00000000-0000-0000-0000-00000000000b') then
    raise exception 'FALLA: clave_cambiada() no bajó la marca propia';
  end if;
  if not (select debe_cambiar_clave from perfiles where id = '00000000-0000-0000-0000-00000000000c') then
    raise exception 'FALLA: clave_cambiada() tocó la fila de otro usuario';
  end if;
  raise notice 'OK: clave_cambiada()';
end $$;
reset role;

-- ---------- Punto 7: ningún bucket acepta SVG ----------
do $$ begin
  if exists (select 1 from storage.buckets where allowed_mime_types is null
             or exists (select 1 from unnest(allowed_mime_types) t where t like '%*%' or t like '%svg%')) then
    raise exception 'FALLA: hay buckets que aceptan SVG o cualquier imagen';
  end if;
  raise notice 'OK: buckets con tipos exactos';
end $$;

-- ---------- Sanitización solo para supervisor y admin; SEAP descuenta estanques ----------
insert into sanitizaciones (id, empresa_id, cliente_id, lugar, estanques) values
  ('00000000-0000-0000-0000-0000000000a1', 'lafken', '00000000-0000-0000-0000-0000000000c3', 'Planta', 5);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
set local role authenticated;
do $$ declare ok boolean := false; begin
  if exists (select 1 from sanitizaciones) then raise exception 'FALLA: un operario ve las sanitizaciones'; end if;
  if exists (select 1 from sanitizaciones_coordinadas('lafken')) then raise exception 'FALLA: aparece una sanitización no coordinada'; end if;
  begin
    perform srv_guardar(null, '{"empresa_id":"lafken","cliente_id":"00000000-0000-0000-0000-0000000000c3","fecha":"2026-02-01",
                               "tipos":["SEAP"],"iv":"5555","sanitizacion_id":"00000000-0000-0000-0000-0000000000a1","estanques":1}',
                        array['00000000-0000-0000-0000-0000000000e1']::uuid[]);
  exception when others then ok := sqlerrm like 'SEAP:%';
  end;
  if not ok then raise exception 'FALLA: se registró un SEAP sin sanitización coordinada'; end if;
  raise notice 'OK: operario sin acceso a sanitización; SEAP rechazado sin coordinación';
end $$;
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);  -- el admin la coordina
update sanitizaciones set estado = 'Coordinado' where id = '00000000-0000-0000-0000-0000000000a1';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
set local role authenticated;
do $$ declare v uuid; ok boolean := false;
  pend int; datos jsonb := '{"empresa_id":"lafken","cliente_id":"00000000-0000-0000-0000-0000000000c3","fecha":"2026-02-01",
                             "tipos":["SEAP"],"iv":"5555","sanitizacion_id":"00000000-0000-0000-0000-0000000000a1"}';
begin
  if (select pendientes from sanitizaciones_coordinadas('lafken')) <> 5 then raise exception 'FALLA: no aparece la sanitización coordinada con 5 pendientes'; end if;
  if exists (select 1 from sanitizaciones_coordinadas('omega')) then raise exception 'FALLA: sanitizaciones_coordinadas() muestra otra empresa'; end if;
  v := srv_guardar(null, datos || '{"estanques":2}', array['00000000-0000-0000-0000-0000000000e1']::uuid[]);
  pend := (select pendientes from sanitizaciones_coordinadas('lafken'));
  if pend <> 3 then raise exception 'FALLA: SEAP de 2 estanques dejó % pendientes (esperado 3)', pend; end if;
  perform srv_guardar(v, datos || '{"estanques":4}', array['00000000-0000-0000-0000-0000000000e1']::uuid[]);
  pend := (select pendientes from sanitizaciones_coordinadas('lafken'));
  if pend <> 1 then raise exception 'FALLA: editar el SEAP a 4 estanques dejó % pendientes (esperado 1)', pend; end if;
  begin
    perform srv_guardar(null, datos || '{"estanques":2}', array['00000000-0000-0000-0000-0000000000e1']::uuid[]);
  exception when others then ok := sqlerrm like 'SEAP:%';
  end;
  if not ok then raise exception 'FALLA: un SEAP descontó más estanques de los pendientes'; end if;
  reset role;
  delete from servicios where id = v;  -- como admin
  pend := (select coalesce(estanques_pendientes, -1) from sanitizaciones where id = '00000000-0000-0000-0000-0000000000a1');
  if pend <> 5 then raise exception 'FALLA: borrar el SEAP dejó % pendientes (esperado 5)', pend; end if;
  raise notice 'OK: SEAP descuenta, corrige y devuelve estanques';
end $$;
reset role;

-- ---------- Subir facturas: cliente nuevo, factura nueva, factura repetida; solo admin ----------
insert into rut_clientes (rut, nombre, facturas) values ('71.551.500-8', 'UNIVERSIDAD SANTO TOMAS', array['F1.pdf (07 de Abril del 2019, $404.600)']);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
set local role authenticated;
do $$ declare ok boolean := false; begin
  begin perform agregar_facturas('[{"rut":"1-9","nombre":"X","factura":"Z.pdf (01 de Enero del 2024, $1)"}]');
  exception when others then ok := true; end;
  if not ok then raise exception 'FALLA: un operario pudo subir facturas'; end if;
  raise notice 'OK: solo el admin sube facturas';
end $$;
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;
do $$ declare r jsonb; begin
  r := agregar_facturas('[
    {"rut":"71.551.500-8","nombre":"UNIVERSIDAD SANTO TOMAS","factura":"F2.pdf (08 de Abril del 2019, $10.000)"},
    {"rut":"71.551.500-8","nombre":"UNIVERSIDAD SANTO TOMAS","factura":"F1.pdf (07 de Abril del 2019, $404.600)"},
    {"rut":"76.000.000-0","nombre":"CLIENTE NUEVO","direccion":"CALLE 1","comuna":"PUERTO MONTT","ciudad":"PUERTO MONTT","factura":"F3.pdf (09 de Abril del 2019, $5.000)"}]');
  if r <> '{"nuevos": 1, "agregadas": 2, "repetidas": 1}'::jsonb then raise exception 'FALLA: agregar_facturas devolvió %', r; end if;
  if (select n_facturas from rut_clientes where rut = '71.551.500-8') <> 2 then raise exception 'FALLA: la factura no se sumó al cliente'; end if;
  if (select comuna from rut_clientes where rut = '76.000.000-0') <> 'PUERTO MONTT' then raise exception 'FALLA: el cliente nuevo no quedó con sus datos'; end if;
  raise notice 'OK: subir facturas suma, crea y no repite';
end $$;
reset role;

-- ---------- Clientes desde RUT Clientes ----------
insert into rut_clientes (rut, nombre, comuna) values ('96.870.780-9', 'ACCOR HOTELS CHILE S A', 'LAS CONDES');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);  -- operario de Lafken
set local role authenticated;
do $$ declare v uuid; w uuid; begin
  if not exists (select 1 from buscar_clientes('lafken', 'a') where nombre = 'ACCOR HOTELS CHILE S A' and id is null) then
    raise exception 'FALLA: buscar "a" no encuentra ACCOR en RUT Clientes';
  end if;
  if not exists (select 1 from buscar_clientes('lafken', '96870') where nombre = 'ACCOR HOTELS CHILE S A') then
    raise exception 'FALLA: buscar por RUT sin puntos no encuentra ACCOR';
  end if;
  if exists (select 1 from buscar_clientes('omega', 'a')) then raise exception 'FALLA: un operario de Lafken busca en Omega'; end if;
  v := cliente_desde_rut('lafken', '96.870.780-9');
  w := cliente_desde_rut('lafken', '96.870.780-9');
  if v is distinct from w then raise exception 'FALLA: elegir dos veces el mismo RUT creó dos clientes'; end if;
  if (select rut from clientes where id = v) <> '96.870.780-9' then raise exception 'FALLA: el cliente creado no tiene su RUT'; end if;
  if (select count(*) from buscar_clientes('lafken', 'accor')) <> 1 or (select id from buscar_clientes('lafken', 'accor')) <> v then
    raise exception 'FALLA: ACCOR aparece repetido después de crearlo';
  end if;
  begin perform cliente_desde_rut('omega', '96.870.780-9'); raise exception 'FALLA: creó un cliente en otra empresa';
  exception when insufficient_privilege then null; end;
  raise notice 'OK: clientes desde RUT Clientes';
end $$;
reset role;

-- ---------- CSI y calendario de visitas ----------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);  -- operario de Lafken
set local role authenticated;
do $$ declare ok boolean := false; begin
  begin
    perform srv_guardar(null, '{"empresa_id":"lafken","cliente_id":"00000000-0000-0000-0000-0000000000c3","fecha":"2026-03-01",
      "tipos":["Desratización"],"iv":"7777","visitas":2,"visita":1,"csi":"12345"}', array['00000000-0000-0000-0000-0000000000e1']::uuid[]);
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'FALLA: se guardó un CSI en una visita que no es la última'; end if;
  perform srv_guardar(null, '{"empresa_id":"lafken","cliente_id":"00000000-0000-0000-0000-0000000000c3","fecha":"2026-03-01",
    "tipos":["Desratización"],"iv":"7777","visitas":1,"csi":"12345"}', array['00000000-0000-0000-0000-0000000000e1']::uuid[]);
  ok := false;
  begin insert into planes_visita (empresa_id, cliente_id, tipo, cada) values ('lafken', '00000000-0000-0000-0000-0000000000c3', 'Desratización', 2);
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FALLA: un operario creó un plan de visitas'; end if;
  raise notice 'OK: CSI solo en la última visita; el operario no crea planes';
end $$;
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);  -- admin
set local role authenticated;
do $$ declare p date; begin
  insert into planes_visita (empresa_id, cliente_id, tipo, cada, inicio)
  values ('lafken', '00000000-0000-0000-0000-0000000000c3', 'Desratización', 2, '2026-01-01'),
         ('lafken', '00000000-0000-0000-0000-0000000000c3', 'Desinsectación', 3, '2026-07-01');
  p := (select proxima from proximas_visitas('lafken') where tipo = 'Desratización');
  if p <> '2026-05-01' then raise exception 'FALLA: próxima desratización % (esperado 2026-05-01: último servicio 1-mar + 2 meses)', p; end if;
  p := (select proxima from proximas_visitas('lafken') where tipo = 'Desinsectación');
  if p <> '2026-07-01' then raise exception 'FALLA: sin servicios previos la próxima debe ser el inicio, fue %', p; end if;
  insert into planes_visita (empresa_id, cliente_id, tipo, cada, unidad, inicio)
  values ('lafken', '00000000-0000-0000-0000-0000000000c3', 'Desinfección', 15, 'dias', '2026-01-01');
  insert into servicios (empresa_id, cliente_id, fecha, tipos) values ('lafken', '00000000-0000-0000-0000-0000000000c3', '2026-02-20', '{Desinfección}');
  p := (select proxima from proximas_visitas('lafken') where tipo = 'Desinfección');
  if p <> '2026-03-07' then raise exception 'FALLA: cada 15 días desde 20-feb debió dar 2026-03-07, dio %', p; end if;
  raise notice 'OK: calendario calcula la próxima visita (meses y días)';
end $$;
reset role;

rollback;
\echo 'Todas las pruebas pasaron.'
