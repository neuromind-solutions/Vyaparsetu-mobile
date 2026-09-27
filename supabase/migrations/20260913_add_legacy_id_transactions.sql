-- VyaparSetu — Migration: Add legacy_id to transactions for desktop→Supabase sync
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/amsaohpdcblmjyempmmb/sql/new

ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS legacy_id TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS supabase_uuid UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tx_shop_legacy
    ON public.transactions(shop_id, legacy_id)
    WHERE legacy_id IS NOT NULL;
