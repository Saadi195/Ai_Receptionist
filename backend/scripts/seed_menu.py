import os
import sys
import json
import argparse
from pathlib import Path

# Add parent directory to sys.path to import database
sys.path.append(str(Path(__file__).parent.parent))
from database.supabase_client import get_supabase

def seed_menu(force: bool = False):
    db = get_supabase()
    
    # Check if menu_items already has rows
    existing = db.table("menu_items").select("id").limit(1).execute()
    if existing.data and len(existing.data) > 0 and not force:
        print("[SEED] menu_items table already has rows. Skipping seed (use --force to re-seed).", flush=True)
        return
    
    if force and existing.data and len(existing.data) > 0:
        print("[SEED] --force flag specified. Deleting existing menu items...", flush=True)
        # Delete all items where id is not null
        db.table("menu_items").delete().neq("canonical_name", "NON_EXISTENT_PLACEHOLDER").execute()
    
    menu_path = Path(__file__).parent.parent / "data" / "menu.json"
    if not menu_path.exists():
        print(f"[ERROR] menu.json not found at {menu_path}", flush=True)
        return
    
    with open(menu_path, "r", encoding="utf-8") as f:
        menu_data = json.load(f)
    
    items_to_insert = []
    for cat in menu_data.get("categories", []):
        cat_name = cat.get("name", "main")
        for item in cat.get("items", []):
            items_to_insert.append({
                "canonical_name": item["canonical_name"],
                "urdu_name": item.get("urdu_name", ""),
                "category": cat_name,
                "price": item["price"],
                "available": item.get("available", True),
                "aliases": item.get("aliases", []),
                "modifications": item.get("modifications", []),
                "preparation_minutes": item.get("preparation_minutes", 15)
            })
    
    if not items_to_insert:
        print("[SEED] No items found in menu.json to insert.", flush=True)
        return
    
    res = db.table("menu_items").insert(items_to_insert).execute()
    count = len(res.data) if res.data else len(items_to_insert)
    print(f"Seeded {count} items to menu_items table.", flush=True)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed menu items into Supabase")
    parser.add_argument("--force", action="store_true", help="Force re-seed even if table is not empty")
    args = parser.parse_args()
    seed_menu(force=args.force)
