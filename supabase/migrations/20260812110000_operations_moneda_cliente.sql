alter table operations add column moneda_cliente text not null default 'USD' check (moneda_cliente in ('USD', 'USDT'));
