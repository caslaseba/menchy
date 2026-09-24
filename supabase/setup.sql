-- Menchy: base compartida, gratis, sin tarjeta.
-- La clave de la app vive en Supabase Auth. Estas tablas no se leen sin entrar.

create table if not exists categories (
  id bigint generated always as identity primary key,
  name text not null,
  color text not null,
  created_at text not null
);
create unique index if not exists categories_name_lower on categories (lower(name));

create table if not exists suppliers (
  id bigint generated always as identity primary key,
  name text not null,
  phone text not null default '',
  notes text not null default '',
  created_at text not null
);
create unique index if not exists suppliers_name_lower on suppliers (lower(name));

create table if not exists products (
  id bigint generated always as identity primary key,
  name text not null,
  barcode text,
  category_id bigint not null references categories(id),
  supplier_id bigint references suppliers(id) on delete set null,
  cost_cents integer not null default 0,
  price_cents integer not null default 0,
  stock integer not null default 0,
  min_stock integer not null default 0,
  photo text,
  active integer not null default 1,
  created_at text not null
);
create unique index if not exists products_barcode_unique
  on products (barcode) where barcode is not null;

create table if not exists sales (
  id bigint generated always as identity primary key,
  created_at text not null,
  payment_method text not null,
  total_cents integer not null,
  paid_cents integer not null,
  change_cents integer not null,
  cost_cents integer not null
);
create index if not exists sales_created_idx on sales (created_at);

create table if not exists sale_items (
  id bigint generated always as identity primary key,
  sale_id bigint not null references sales(id),
  product_id bigint references products(id),
  name text not null,
  barcode text,
  qty integer not null,
  price_cents integer not null,
  cost_cents integer not null
);

alter table categories enable row level security;
alter table suppliers enable row level security;
alter table products enable row level security;
alter table sales enable row level security;
alter table sale_items enable row level security;

drop policy if exists "auth all categories" on categories;
drop policy if exists "auth all suppliers" on suppliers;
drop policy if exists "auth all products" on products;
drop policy if exists "auth all sales" on sales;
drop policy if exists "auth all sale_items" on sale_items;

create policy "auth all categories" on categories for all to authenticated using (true) with check (true);
create policy "auth all suppliers" on suppliers for all to authenticated using (true) with check (true);
create policy "auth all products" on products for all to authenticated using (true) with check (true);
create policy "auth all sales" on sales for all to authenticated using (true) with check (true);
create policy "auth all sale_items" on sale_items for all to authenticated using (true) with check (true);

insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do update set public = true;

drop policy if exists "photos public read" on storage.objects;
drop policy if exists "photos auth insert" on storage.objects;
drop policy if exists "photos auth update" on storage.objects;
drop policy if exists "photos auth delete" on storage.objects;

create policy "photos public read" on storage.objects for select using (bucket_id = 'photos');
create policy "photos auth insert" on storage.objects for insert to authenticated with check (bucket_id = 'photos');
create policy "photos auth update" on storage.objects for update to authenticated using (bucket_id = 'photos');
create policy "photos auth delete" on storage.objects for delete to authenticated using (bucket_id = 'photos');

create or replace function public.keep_alive()
returns integer
language sql
security definer
set search_path = public
as $$ select 1 $$;

revoke all on function public.keep_alive() from public;
grant execute on function public.keep_alive() to anon, authenticated;

create or replace function public.place_sale(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  method text;
  item jsonb;
  pid bigint;
  qty integer;
  qty_map jsonb := '{}'::jsonb;
  rec record;
  prod products%rowtype;
  total integer := 0;
  cost integer := 0;
  paid integer;
  change integer := 0;
  sale_id bigint;
  created text;
  updated integer;
  lines jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Tenés que entrar con la clave';
  end if;

  method := payload->>'payment_method';
  if method not in ('efectivo', 'debito', 'credito', 'transferencia') then
    raise exception 'Elegí cómo paga el cliente';
  end if;
  if jsonb_typeof(payload->'items') is distinct from 'array' or jsonb_array_length(payload->'items') = 0 then
    raise exception 'No hay productos en la venta';
  end if;

  for item in select value from jsonb_array_elements(payload->'items') loop
    begin
      pid := (item->>'product_id')::bigint;
      qty := (item->>'qty')::integer;
    exception when others then
      raise exception 'Producto inválido';
    end;
    if pid is null or pid <= 0 then
      raise exception 'Producto inválido';
    end if;
    if qty is null or qty <= 0 or qty > 9999 then
      raise exception 'Cantidad inválida';
    end if;
    qty_map := qty_map || jsonb_build_object(
      pid::text,
      coalesce((qty_map->>pid::text)::integer, 0) + qty
    );
  end loop;

  for rec in
    select key::bigint as product_id, value::integer as qty
    from jsonb_each_text(qty_map)
    order by key::bigint
  loop
    select * into prod from products where id = rec.product_id and active = 1 for update;
    if not found then
      raise exception 'Hay un producto que ya no está disponible';
    end if;
    if prod.stock < rec.qty then
      raise exception 'Stock insuficiente de %. Hay %.', prod.name, prod.stock;
    end if;
    total := total + prod.price_cents * rec.qty;
    cost := cost + prod.cost_cents * rec.qty;
    lines := lines || jsonb_build_array(jsonb_build_object(
      'product_id', prod.id,
      'name', prod.name,
      'barcode', prod.barcode,
      'qty', rec.qty,
      'price_cents', prod.price_cents,
      'cost_cents', prod.cost_cents
    ));
  end loop;

  if payload ? 'expected_total_cents'
     and nullif(payload->>'expected_total_cents', '') is not null
     and (payload->>'expected_total_cents') ~ '^[0-9]+$'
     and (payload->>'expected_total_cents')::integer <> total then
    raise exception 'Los precios cambiaron. Revisá la venta.';
  end if;

  paid := total;
  change := 0;
  if method = 'efectivo' then
    if coalesce(payload->>'paid_cents', '') !~ '^[0-9]+$' then
      raise exception 'Ingresá con cuánto paga';
    end if;
    paid := (payload->>'paid_cents')::integer;
    if paid < total then
      raise exception 'El pago en efectivo no alcanza';
    end if;
    change := paid - total;
  end if;

  created := to_char(timezone('America/Argentina/Buenos_Aires', now()), 'YYYY-MM-DD HH24:MI:SS');

  insert into sales (created_at, payment_method, total_cents, paid_cents, change_cents, cost_cents)
  values (created, method, total, paid, change, cost)
  returning id into sale_id;

  insert into sale_items (sale_id, product_id, name, barcode, qty, price_cents, cost_cents)
  select sale_id,
         (line->>'product_id')::bigint,
         line->>'name',
         nullif(line->>'barcode', ''),
         (line->>'qty')::integer,
         (line->>'price_cents')::integer,
         (line->>'cost_cents')::integer
  from jsonb_array_elements(lines) line;

  for rec in
    select key::bigint as product_id, value::integer as qty
    from jsonb_each_text(qty_map)
  loop
    update products
      set stock = stock - rec.qty
      where id = rec.product_id and active = 1 and stock >= rec.qty;
    get diagnostics updated = row_count;
    if updated <> 1 then
      raise exception 'Stock insuficiente';
    end if;
  end loop;

  return (
    select jsonb_build_object(
      'id', s.id,
      'created_at', s.created_at,
      'payment_method', s.payment_method,
      'total_cents', s.total_cents,
      'paid_cents', s.paid_cents,
      'change_cents', s.change_cents,
      'cost_cents', s.cost_cents,
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', si.id,
          'product_id', si.product_id,
          'name', si.name,
          'barcode', coalesce(si.barcode, ''),
          'qty', si.qty,
          'price_cents', si.price_cents,
          'cost_cents', si.cost_cents
        ) order by si.id)
        from sale_items si
        where si.sale_id = s.id
      ), '[]'::jsonb)
    )
    from sales s
    where s.id = sale_id
  );
end;
$$;

revoke all on function public.place_sale(jsonb) from public, anon;
grant execute on function public.place_sale(jsonb) to authenticated;

create or replace function public._seed_at(days integer, hh integer, mm integer)
returns text
language sql
as $$
  select to_char((timezone('America/Argentina/Buenos_Aires', now()))::date - days, 'YYYY-MM-DD')
    || ' ' || lpad(hh::text, 2, '0') || ':' || lpad(mm::text, 2, '0') || ':00'
$$;

create or replace function public._seed_sale(p_created text, p_method text, p_paid integer, p_items jsonb)
returns void
language plpgsql
as $$
declare
  item jsonb;
  prod products%rowtype;
  total integer := 0;
  cost integer := 0;
  paid integer;
  change integer := 0;
  sid bigint;
begin
  for item in select value from jsonb_array_elements(p_items) loop
    select * into prod from products where barcode = item->>'barcode';
    total := total + prod.price_cents * (item->>'qty')::integer;
    cost := cost + prod.cost_cents * (item->>'qty')::integer;
  end loop;
  if p_method = 'efectivo' then
    paid := p_paid;
    change := paid - total;
  else
    paid := total;
    change := 0;
  end if;
  insert into sales (created_at, payment_method, total_cents, paid_cents, change_cents, cost_cents)
  values (p_created, p_method, total, paid, change, cost)
  returning id into sid;
  for item in select value from jsonb_array_elements(p_items) loop
    select * into prod from products where barcode = item->>'barcode';
    insert into sale_items (sale_id, product_id, name, barcode, qty, price_cents, cost_cents)
    values (sid, prod.id, prod.name, prod.barcode, (item->>'qty')::integer, prod.price_cents, prod.cost_cents);
  end loop;
end;
$$;

do $$
declare
  created text := public._seed_at(0, 8, 0);
  site text := 'https://caslaseba.github.io/menchy/fotos/';
  bebidas bigint;
  almacen bigint;
  lacteos bigint;
  limpieza bigint;
  golosinas bigint;
  fiambres bigint;
  sur bigint;
  valle bigint;
  norte bigint;
  ramos bigint;
begin
  if (select count(*) from categories) > 0 then
    return;
  end if;

  insert into categories (name, color, created_at) values
    ('Bebidas', '#1d4e89', created),
    ('Almacén', '#c2410c', created),
    ('Lácteos', '#a16207', created),
    ('Limpieza', '#0f6e56', created),
    ('Golosinas', '#be185d', created),
    ('Fiambres', '#7c3aed', created);
  select id into bebidas from categories where name = 'Bebidas';
  select id into almacen from categories where name = 'Almacén';
  select id into lacteos from categories where name = 'Lácteos';
  select id into limpieza from categories where name = 'Limpieza';
  select id into golosinas from categories where name = 'Golosinas';
  select id into fiambres from categories where name = 'Fiambres';

  insert into suppliers (name, phone, notes, created_at) values
    ('Distribuidora Sur', '11 4567-8901', 'Entrega martes y viernes. Pedido mínimo $ 80.000.', created),
    ('Lácteos del Valle', '11 5123-4400', 'Cadena de frío. Avisar si falta hielo en el pedido.', created),
    ('Limpieza Norte', '11 4788-2201', 'Factura A. Pago a 15 días.', created),
    ('Golosinas Ramos', '11 6033-1188', 'Reposición semanal los lunes a la mañana.', created);
  select id into sur from suppliers where name = 'Distribuidora Sur';
  select id into valle from suppliers where name = 'Lácteos del Valle';
  select id into norte from suppliers where name = 'Limpieza Norte';
  select id into ramos from suppliers where name = 'Golosinas Ramos';

  insert into products (name, barcode, category_id, supplier_id, cost_cents, price_cents, stock, min_stock, photo, active, created_at) values
    ('Agua mineral 500 ml', '7798001000001', bebidas, sur, 80000, 150000, 24, 8, site || '7798001000001.svg', 1, created),
    ('Gaseosa cola 1,5 l', '7798001000002', bebidas, sur, 180000, 320000, 12, 6, site || '7798001000002.svg', 1, created),
    ('Jugo de naranja 1 l', '7798001000003', bebidas, sur, 140000, 260000, 9, 4, site || '7798001000003.svg', 1, created),
    ('Yerba mate 1 kg', '7798001000004', almacen, sur, 320000, 540000, 0, 4, site || '7798001000004.svg', 1, created),
    ('Arroz largo fino 1 kg', '7798001000005', almacen, sur, 150000, 280000, 18, 6, site || '7798001000005.svg', 1, created),
    ('Fideos spaghetti 500 g', '7798001000006', almacen, sur, 90000, 170000, 20, 8, site || '7798001000006.svg', 1, created),
    ('Aceite de girasol 900 ml', '7798001000007', almacen, sur, 280000, 460000, 2, 5, site || '7798001000007.svg', 1, created),
    ('Leche entera 1 l', '7798001000008', lacteos, valle, 120000, 210000, 10, 6, site || '7798001000008.svg', 1, created),
    ('Yogur firme vainilla', '7798001000009', lacteos, valle, 70000, 140000, 8, 6, site || '7798001000009.svg', 1, created),
    ('Queso cremoso por kg', '7798001000010', lacteos, valle, 650000, 980000, 3, 2, site || '7798001000010.svg', 1, created),
    ('Detergente limón 750 ml', '7798001000011', limpieza, norte, 160000, 290000, 7, 3, site || '7798001000011.svg', 1, created),
    ('Lavandina 1 l', '7798001000012', limpieza, norte, 90000, 180000, 1, 4, site || '7798001000012.svg', 1, created),
    ('Alfajor de chocolate', '7798001000013', golosinas, ramos, 80000, 160000, 30, 10, site || '7798001000013.svg', 1, created),
    ('Caramelos de menta 100 g', '7798001000014', golosinas, ramos, 50000, 110000, 15, 5, site || '7798001000014.svg', 1, created),
    ('Jamón cocido 200 g', '7798001000015', fiambres, valle, 280000, 470000, 5, 3, site || '7798001000015.svg', 1, created),
    ('Salchichas 6 unidades', '7798001000016', fiambres, valle, 220000, 390000, 4, 3, site || '7798001000016.svg', 1, created);

  perform public._seed_sale(public._seed_at(0, 9, 15), 'efectivo', 500000, '[{"barcode":"7798001000001","qty":2}]');
  perform public._seed_sale(public._seed_at(0, 11, 22), 'debito', 0, '[{"barcode":"7798001000002","qty":1},{"barcode":"7798001000013","qty":2}]');
  perform public._seed_sale(public._seed_at(0, 13, 40), 'credito', 0, '[{"barcode":"7798001000008","qty":2},{"barcode":"7798001000006","qty":1}]');
  perform public._seed_sale(public._seed_at(0, 16, 5), 'transferencia', 0, '[{"barcode":"7798001000015","qty":1}]');
  perform public._seed_sale(public._seed_at(0, 19, 10), 'efectivo', 1000000, '[{"barcode":"7798001000013","qty":3},{"barcode":"7798001000014","qty":1}]');
  perform public._seed_sale(public._seed_at(1, 10, 5), 'efectivo', 1000000, '[{"barcode":"7798001000005","qty":1},{"barcode":"7798001000007","qty":1}]');
  perform public._seed_sale(public._seed_at(1, 15, 30), 'debito', 0, '[{"barcode":"7798001000009","qty":3}]');
  perform public._seed_sale(public._seed_at(1, 18, 20), 'credito', 0, '[{"barcode":"7798001000016","qty":2}]');
  perform public._seed_sale(public._seed_at(2, 8, 40), 'efectivo', 500000, '[{"barcode":"7798001000001","qty":3}]');
  perform public._seed_sale(public._seed_at(2, 12, 15), 'transferencia', 0, '[{"barcode":"7798001000010","qty":1}]');
  perform public._seed_sale(public._seed_at(2, 17, 45), 'debito', 0, '[{"barcode":"7798001000011","qty":1},{"barcode":"7798001000012","qty":1}]');
  perform public._seed_sale(public._seed_at(6, 11, 10), 'efectivo', 1000000, '[{"barcode":"7798001000002","qty":2},{"barcode":"7798001000001","qty":1}]');
  perform public._seed_sale(public._seed_at(6, 19, 5), 'credito', 0, '[{"barcode":"7798001000013","qty":4}]');
  perform public._seed_sale(public._seed_at(10, 9, 50), 'debito', 0, '[{"barcode":"7798001000008","qty":4},{"barcode":"7798001000009","qty":2}]');
  perform public._seed_sale(public._seed_at(10, 16, 25), 'transferencia', 0, '[{"barcode":"7798001000005","qty":2},{"barcode":"7798001000006","qty":3}]');
  perform public._seed_sale(public._seed_at(15, 13, 15), 'efectivo', 2000000, '[{"barcode":"7798001000015","qty":2},{"barcode":"7798001000010","qty":1}]');
  perform public._seed_sale(public._seed_at(19, 18, 40), 'debito', 0, '[{"barcode":"7798001000003","qty":2},{"barcode":"7798001000014","qty":2}]');
end $$;

drop function if exists public._seed_sale(text, text, integer, jsonb);
drop function if exists public._seed_at(integer, integer, integer);
