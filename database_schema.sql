-- Database Schema for Restaurant AI Ordering (Phase 1)
-- Run this in your Supabase SQL Editor

-- 1. Create Users Table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT,
  phone TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create Menu Items Table
CREATE TABLE menu_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  price DECIMAL(10, 2) NOT NULL,
  category TEXT,
  is_available BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Create Orders Table
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  status TEXT DEFAULT 'pending', -- pending, preparing, ready, completed
  total_amount DECIMAL(10, 2) NOT NULL,
  items JSONB,
  session_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phase 5 Migration (Run in Supabase SQL Editor if orders table already exists):
ALTER TABLE orders ADD COLUMN IF NOT EXISTS items JSONB;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS session_id TEXT;
ALTER TABLE orders ALTER COLUMN user_id DROP NOT NULL;

-- 4. Create Order Items Table
CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID REFERENCES orders(id),
  menu_item_id UUID REFERENCES menu_items(id),
  quantity INTEGER NOT NULL,
  special_instructions TEXT,
  price DECIMAL(10, 2) NOT NULL
);

-- 5. Create Conversations Table
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  transcript TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Create Logs Table
CREATE TABLE logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  level TEXT,
  message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── PHASE 6 SCHEMA MIGRATION ────────────────────────────────────────────────
-- Run this entire block in your Supabase SQL Editor:

-- Core requirement for Realtime UPDATE events
ALTER TABLE orders REPLICA IDENTITY FULL;
-- Note: If orders is already in supabase_realtime publication, comment out the line below:
-- ALTER PUBLICATION supabase_realtime ADD TABLE orders;

-- User profiles table (DO NOT modify auth schema)
CREATE TABLE IF NOT EXISTS user_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin')),
  display_name text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile
CREATE POLICY "users_read_own_profile" ON user_profiles
  FOR SELECT USING (auth.uid() = id);

-- Only service role can insert profiles (signup handled by backend)
CREATE POLICY "service_role_insert_profiles" ON user_profiles
  FOR INSERT WITH CHECK (true);

-- Security definer functions to prevent RLS infinite recursion
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Admin can read all profiles
CREATE POLICY "admin_read_all_profiles" ON user_profiles
  FOR SELECT USING (is_admin());

-- Menu items table
CREATE TABLE IF NOT EXISTS menu_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name text NOT NULL,
  urdu_name text,
  category text NOT NULL DEFAULT 'main',
  price integer NOT NULL,
  available boolean NOT NULL DEFAULT true,
  aliases jsonb NOT NULL DEFAULT '[]',
  modifications jsonb NOT NULL DEFAULT '[]',
  preparation_minutes integer DEFAULT 15,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;

-- Anyone can read available menu items (ordering system needs this)
CREATE POLICY "public_read_available_menu" ON menu_items
  FOR SELECT USING (true);

-- Only admin can modify menu
CREATE POLICY "admin_modify_menu" ON menu_items
  FOR ALL USING (is_admin());

-- Orders RLS
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_insert_orders" ON orders
  FOR INSERT WITH CHECK (true);

CREATE POLICY "authenticated_read_orders" ON orders
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "admin_update_orders" ON orders
  FOR UPDATE USING (is_admin());
