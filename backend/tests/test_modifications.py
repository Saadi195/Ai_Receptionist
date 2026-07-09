import pytest
from conversation_manager import ConversationManager

def test_validate_modifications_valid():
    cm = ConversationManager(session_id="test-mods-1")
    raw_mods = [
        {"type": "remove", "ingredient": "onion", "display": "Bina onion ke", "urdu_display": "بغیر onion کے"},
        {"type": "add", "ingredient": "cheese", "display": "Extra cheese", "urdu_display": "اضافی cheese"}
    ]
    validated = cm._validate_modifications(raw_mods)
    assert len(validated) == 2
    assert validated[0]["type"] == "remove"
    assert validated[0]["ingredient"] == "onion"
    assert validated[1]["type"] == "add"
    assert validated[1]["ingredient"] == "cheese"

def test_validate_modifications_invalid():
    cm = ConversationManager(session_id="test-mods-2")
    # Test non-list
    assert cm._validate_modifications("not a list") == []
    assert cm._validate_modifications(None) == []
    
    # Test list with invalid items
    raw_mods = [
        "just a string",
        {"type": "remove"}, # missing ingredient
        {"ingredient": "onion"}, # missing type
        {"type": "remove", "ingredient": "onion", "display": "Bina onion ke", "urdu_display": "بغیر onion کے"}
    ]
    validated = cm._validate_modifications(raw_mods)
    assert len(validated) == 3
    assert validated[0]["type"] == "remove"
    assert validated[0]["ingredient"] == ""
    assert validated[1]["type"] == "preparation"
    assert validated[1]["ingredient"] == "onion"
    assert validated[2]["ingredient"] == "onion"

def test_validate_order_items_preserves_modifications():
    cm = ConversationManager(session_id="test-mods-3")
    raw_items = [
        {
            "canonical_name": "Beef Burger",
            "quantity": 2,
            "unit_price": 450,
            "line_total": 900,
            "modifications": [
                {"type": "remove", "ingredient": "tomato", "display": "Bina tomato ke", "urdu_display": "بغیر tomato کے"}
            ],
            "special_note": "Well done patty"
        }
    ]
    validated = cm._validate_order_items(raw_items)
    assert len(validated) == 1
    assert validated[0]["canonical_name"] == "Beef Burger"
    assert validated[0]["modifications"][0]["ingredient"] == "tomato"
    assert validated[0]["special_note"] == "Well done patty"
    assert validated[0]["line_total"] == 900
