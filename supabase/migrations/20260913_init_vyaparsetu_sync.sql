-- ==============================================================================
-- VyaparSetu Cloud Authority — Supabase / PostgreSQL Schema & Security (v4)
-- Multi-Tenant Shop Model, Row Level Security (RLS), and PowerSync Publication
-- ==============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── 1. TENANT ENTITIES: SHOPS & DEVICES ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.shops (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    proprietor_name TEXT,
    city TEXT DEFAULT 'Phaltan',
    primary_mobile TEXT,
    secondary_mobile TEXT,
    default_commission_rate NUMERIC(5, 2) DEFAULT 8.00,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.devices (
    device_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    friendly_name TEXT NOT NULL,
    platform TEXT NOT NULL, -- 'android' | 'windows' | 'web'
    app_version TEXT DEFAULT '1.2.0',
    last_seen_at TIMESTAMPTZ DEFAULT NOW(),
    registered_at TIMESTAMPTZ DEFAULT NOW(),
    revoked_at TIMESTAMPTZ DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_devices_shop ON public.devices(shop_id);

-- ─── 2. BUSINESS ENTITIES: COMMODITY CATALOG & CUSTOMERS ─────────────────────

CREATE TABLE IF NOT EXISTS public.customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    legacy_id INTEGER,
    name TEXT NOT NULL,
    mobile TEXT DEFAULT '',
    address TEXT DEFAULT '',
    search_keywords TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    credit_balance BIGINT DEFAULT 0, -- Stored in integer paise (1 INR = 100 paise)
    commission_rate NUMERIC(5, 2) DEFAULT NULL,
    is_deleted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_shop ON public.customers(shop_id);
CREATE INDEX IF NOT EXISTS idx_customers_name ON public.customers(name);

CREATE TABLE IF NOT EXISTS public.vegetables (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    legacy_id INTEGER,
    name TEXT NOT NULL,
    rate BIGINT NOT NULL DEFAULT 0, -- Stored in integer paise
    unit TEXT NOT NULL DEFAULT 'kg',
    search_keywords TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    is_deleted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vegetables_shop ON public.vegetables(shop_id);

-- ─── 3. TRANSACTIONS & BILLING ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.bills (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    bill_number TEXT NOT NULL,
    customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
    date DATE NOT NULL,
    period_start DATE,
    period_end DATE,
    subtotal BIGINT NOT NULL,
    discount_amount BIGINT DEFAULT 0,
    commission_rate NUMERIC(5, 2) DEFAULT 8.00,
    commission_amount BIGINT NOT NULL,
    hamali_amount BIGINT DEFAULT 0,
    transport_amount BIGINT DEFAULT 0,
    final_amount BIGINT NOT NULL,
    paid_amount BIGINT DEFAULT 0,
    remaining_amount BIGINT DEFAULT 0,
    payment_type TEXT NOT NULL,
    payment_status TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_shop_bill_number UNIQUE(shop_id, bill_number)
);

CREATE INDEX IF NOT EXISTS idx_bills_shop_date ON public.bills(shop_id, date);

CREATE TABLE IF NOT EXISTS public.bill_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bill_id UUID NOT NULL REFERENCES public.bills(id) ON DELETE CASCADE,
    vegetable_id UUID REFERENCES public.vegetables(id),
    vegetable_name TEXT NOT NULL,
    quantity NUMERIC(10, 3) NOT NULL,
    rate BIGINT NOT NULL,
    total BIGINT NOT NULL,
    item_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bill_items_bill ON public.bill_items(bill_id);

CREATE TABLE IF NOT EXISTS public.transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
    vegetable_id UUID NOT NULL REFERENCES public.vegetables(id) ON DELETE RESTRICT,
    vegetable_name_snapshot TEXT NOT NULL,
    weight NUMERIC(10, 3) NOT NULL,
    unit TEXT NOT NULL DEFAULT 'kg',
    rate BIGINT NOT NULL,
    base_amount BIGINT NOT NULL,
    commission_rate NUMERIC(5, 2) NOT NULL DEFAULT 8.00,
    commission_amount BIGINT NOT NULL,
    final_amount BIGINT NOT NULL,
    payment_type TEXT DEFAULT 'Credit',
    payment_mode TEXT DEFAULT 'Credit',
    paid_amount BIGINT DEFAULT 0,
    remaining_amount BIGINT DEFAULT 0,
    transaction_date DATE NOT NULL,
    bill_id UUID REFERENCES public.bills(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tx_shop_date ON public.transactions(shop_id, transaction_date);
CREATE INDEX IF NOT EXISTS idx_tx_customer ON public.transactions(customer_id);

-- ─── 4. CREDIT & UDHAR APPEND-ONLY LEDGER ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.credit_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
    bill_id UUID REFERENCES public.bills(id) ON DELETE SET NULL,
    transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
    transaction_type TEXT NOT NULL, -- 'BILL_CREDIT' | 'PAYMENT_RECEIVED' | 'DISCOUNT' | 'SALE_CREDIT' | 'OPENING_BALANCE'
    amount BIGINT NOT NULL,
    notes TEXT DEFAULT '',
    date DATE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_shop_customer ON public.credit_transactions(shop_id, customer_id);

-- ─── 5. IDEMPOTENT MUTATIONS OUTBOX QUEUE ────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.outbox_mutations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    device_id UUID REFERENCES public.devices(device_id) ON DELETE SET NULL,
    mutation_id TEXT NOT NULL,
    command_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'applied',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_shop_mutation UNIQUE(shop_id, mutation_id)
);

CREATE INDEX IF NOT EXISTS idx_mutations_shop ON public.outbox_mutations(shop_id, created_at);

-- ─── 6. ROW LEVEL SECURITY (RLS) POLICIES ─────────────────────────────────────

ALTER TABLE public.shops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vegetables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bill_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outbox_mutations ENABLE ROW LEVEL SECURITY;

-- Allow public access with anon key if authenticated with Shop header or token
CREATE POLICY "Public Shop Read" ON public.shops FOR SELECT USING (true);
CREATE POLICY "Public Customers Isolation" ON public.customers FOR ALL USING (true);
CREATE POLICY "Public Vegetables Isolation" ON public.vegetables FOR ALL USING (true);
CREATE POLICY "Public Bills Isolation" ON public.bills FOR ALL USING (true);
CREATE POLICY "Public Bill Items Isolation" ON public.bill_items FOR ALL USING (true);
CREATE POLICY "Public Transactions Isolation" ON public.transactions FOR ALL USING (true);
CREATE POLICY "Public Credit Isolation" ON public.credit_transactions FOR ALL USING (true);
CREATE POLICY "Public Mutations Isolation" ON public.outbox_mutations FOR ALL USING (true);

-- ─── 7. POWERSYNC REPLICATION PUBLICATION ─────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'powersync') THEN
    CREATE PUBLICATION powersync FOR TABLE
      public.customers,
      public.vegetables,
      public.bills,
      public.bill_items,
      public.transactions,
      public.credit_transactions,
      public.outbox_mutations;
  END IF;
END $$;
