-- VyaparSetu — Complete Multi-Device Synchronization Migration
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/amsaohpdcblmjyempmmb/sql/new

-- 1. Ensure legacy_id columns exist on all tables
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS legacy_id TEXT;
ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS legacy_id TEXT;
ALTER TABLE public.credit_transactions ADD COLUMN IF NOT EXISTS legacy_id TEXT;
ALTER TABLE public.credit_transactions ADD COLUMN IF NOT EXISTS payment_mode TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS legacy_id INTEGER;
ALTER TABLE public.vegetables ADD COLUMN IF NOT EXISTS legacy_id INTEGER;

-- 2. Create unique indexes for robust upsert conflict resolution
CREATE UNIQUE INDEX IF NOT EXISTS uq_tx_shop_legacy
    ON public.transactions(shop_id, legacy_id)
    WHERE legacy_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bills_shop_legacy
    ON public.bills(shop_id, legacy_id)
    WHERE legacy_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_tx_shop_legacy
    ON public.credit_transactions(shop_id, legacy_id)
    WHERE legacy_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cust_shop_legacy
    ON public.customers(shop_id, legacy_id)
    WHERE legacy_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_veg_shop_legacy
    ON public.vegetables(shop_id, legacy_id)
    WHERE legacy_id IS NOT NULL;
