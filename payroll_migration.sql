-- Payroll tables migration
-- Run this in Supabase SQL Editor: https://lsxnbdhyfsuqhopzuwls.supabase.co

create table if not exists employees (
  id text primary key,
  name text not null,
  route_id text references routes(id) on delete set null,
  daily_rate numeric default 0,
  status text default 'active',      -- active | resigned | blacklisted
  nationality text default 'ไทย',
  phone_fee numeric default 0,
  room_fee numeric default 0,
  resign_date date,
  notes text,
  created_at timestamp default now()
);

create table if not exists employee_loans (
  id text primary key,
  employee_id text not null references employees(id) on delete cascade,
  type text not null,                -- permit | loan | advance | other
  description text,
  total_amount numeric default 0,
  per_period_amount numeric default 0,
  paid_amount numeric default 0,
  interest_rate numeric default 0,
  status text default 'active',      -- active | completed | cancelled
  created_at timestamp default now()
);

create table if not exists payroll_periods (
  id text primary key,
  period_key text not null unique,   -- e.g. "2568-01-A" (A=1-10, B=11-20, C=21-31)
  date_from date not null,
  date_to date not null,
  pay_date date not null,
  status text default 'draft',       -- draft | paid
  created_at timestamp default now()
);

create table if not exists payroll_entries (
  id text primary key,
  period_id text not null references payroll_periods(id) on delete cascade,
  employee_id text not null references employees(id) on delete cascade,
  route_id text,
  days_worked numeric default 0,
  bonus numeric default 0,
  advance numeric default 0,
  net_pay numeric default 0,
  notes text,
  created_at timestamp default now(),
  unique(period_id, employee_id)
);

create table if not exists payroll_deductions (
  id text primary key,
  entry_id text not null references payroll_entries(id) on delete cascade,
  loan_id text references employee_loans(id) on delete set null,
  type text not null,                -- permit | loan | advance | phone | room | other
  label text,
  amount numeric default 0,
  created_at timestamp default now()
);
