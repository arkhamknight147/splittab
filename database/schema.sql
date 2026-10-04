-- ============================================================
-- SplitTab Database Schema (Supabase / PostgreSQL)
-- Multi-party dining split utility with fractional line claims
-- ============================================================

-- 1. Enable UUID Extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Sessions Table (Parent dining bill transaction)
CREATE TABLE IF NOT EXISTS public.sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    host_name VARCHAR(255) NOT NULL,
    host_vpa VARCHAR(255) NOT NULL,
    bill_subtotal NUMERIC(10, 2) DEFAULT 0.00,
    cgst_amount NUMERIC(10, 2) DEFAULT 0.00,
    sgst_amount NUMERIC(10, 2) DEFAULT 0.00,
    liquor_vat_amount NUMERIC(10, 2) DEFAULT 0.00,
    service_charge NUMERIC(10, 2) DEFAULT 0.00,
    bill_grand_total NUMERIC(10, 2) DEFAULT 0.00,
    actual_paid_amount NUMERIC(10, 2) DEFAULT 0.00,
    status VARCHAR(50) DEFAULT 'ACTIVE_CLAIMING',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Participants Table (Attendees linked to a session)
CREATE TABLE IF NOT EXISTS public.participants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    payment_status VARCHAR(50) DEFAULT 'UNPAID', -- UNPAID | SELF_PAID | HOST_CONFIRMED
    calculated_subtotal NUMERIC(10, 2) DEFAULT 0.00,
    calculated_final_total NUMERIC(10, 2) DEFAULT 0.00,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Line Items Table (Dishes parsed by Multimodal Vision OCR)
CREATE TABLE IF NOT EXISTS public.line_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
    item_name VARCHAR(255) NOT NULL,
    quantity NUMERIC(10, 2) DEFAULT 1.00,
    unit_price NUMERIC(10, 2) DEFAULT 0.00,
    total_price NUMERIC(10, 2) DEFAULT 0.00,
    is_alcohol BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Item Claims Junction Table (Many-to-Many: Items claimed by Diners)
CREATE TABLE IF NOT EXISTS public.item_claims (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    line_item_id UUID NOT NULL REFERENCES public.line_items(id) ON DELETE CASCADE,
    participant_id UUID NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(line_item_id, participant_id)
);

-- 6. Indexes for High Performance Room Queries
CREATE INDEX IF NOT EXISTS idx_participants_session ON public.participants(session_id);
CREATE INDEX IF NOT EXISTS idx_line_items_session ON public.line_items(session_id);
CREATE INDEX IF NOT EXISTS idx_item_claims_line_item ON public.item_claims(line_item_id);
CREATE INDEX IF NOT EXISTS idx_item_claims_participant ON public.item_claims(participant_id);

-- 7. Permissions & Row Level Security (RLS)
-- Allow public anon read/write scoped for zero-install participation
ALTER TABLE public.sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.participants DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.line_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_claims DISABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE public.sessions TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.participants TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.line_items TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.item_claims TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
