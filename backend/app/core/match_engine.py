from dataclasses import dataclass, field
import re


@dataclass
class LineItem:
    description: str
    qty: float
    unit_price_cents: int
    normalized: str = field(default='')

    def __post_init__(self):
        self.normalized = normalize(self.description)


def normalize(text: str) -> str:
    """Lowercase, strip units, remove filler words for fuzzy matching."""
    text = text.lower()
    for unit in ['inch', 'in.', 'ft', 'feet', 'each', 'ea', 'hrs', 'hours', 'lbs', 'lb']:
        text = re.sub(rf'\b{unit}\b', '', text)
    # Normalize fractions: 3/4 → .75, 1/2 → .5
    text = re.sub(r'\b3/4\b', '.75', text)
    text = re.sub(r'\b1/2\b', '.5', text)
    text = re.sub(r'\b1/4\b', '.25', text)
    # Normalize synonyms
    synonyms = {
        'cpvc': 'copper pipe',
        'replaced': 'install',
        'swap': 'install',
        'swapped': 'install',
        'replaced with': 'install',
    }
    for alias, canonical in synonyms.items():
        text = text.replace(alias, canonical)
    return ' '.join(text.split())


def items_match(note_item: str, invoice_item: str, threshold: float = 0.75) -> bool:
    """True if note item is semantically present in invoice item."""
    n = normalize(note_item)
    iv = normalize(invoice_item)

    if n == iv or n in iv or iv in n:
        return True

    n_tokens = set(n.split())
    iv_tokens = set(iv.split())
    if not n_tokens:
        return False
    overlap = len(n_tokens & iv_tokens) / len(n_tokens)
    return overlap >= threshold


def run_three_way_match(
    estimate_items: list,   # Input A — The Promise
    field_note_items: list, # Input B — parsed by AI
    invoice_items: list,    # Input C — The Bill
) -> dict:
    """
    Core reconciliation function.
    Returns: { status, missing_items, extra_items, estimated_leak_cents }
    """
    missing = []
    extra = []

    for note_item in field_note_items:
        if note_item.get('confidence', 1.0) < 0.5:
            continue  # Skip low-confidence AI extractions

        desc = note_item['item']
        found_in_invoice = any(
            items_match(desc, inv['description'] if isinstance(inv, dict) else inv.description)
            for inv in invoice_items
        )

        if not found_in_invoice:
            est_match = next(
                (e for e in estimate_items
                 if items_match(desc, e['description'] if isinstance(e, dict) else e.description)),
                None
            )
            unit_price = (
                est_match['unit_price_cents'] if isinstance(est_match, dict)
                else est_match.unit_price_cents if est_match else 0
            )
            leak_cents = unit_price * note_item.get('qty', 1) if est_match else 0
            missing.append({
                'item': desc,
                'qty': note_item.get('qty', 1),
                'estimated_leak_cents': int(leak_cents),
                'confidence': note_item.get('confidence', 1.0),
            })

    for inv in invoice_items:
        inv_desc = inv['description'] if isinstance(inv, dict) else inv.description
        in_estimate = any(
            items_match(inv_desc, e['description'] if isinstance(e, dict) else e.description)
            for e in estimate_items
        )
        if not in_estimate:
            inv_price = inv['unit_price_cents'] if isinstance(inv, dict) else inv.unit_price_cents
            extra.append({'item': inv_desc, 'unit_price_cents': inv_price})

    total_leak = sum(m['estimated_leak_cents'] for m in missing)
    status = 'discrepancy' if missing else 'clean'

    return {
        'status': status,
        'missing_items': missing,
        'extra_items': extra,
        'estimated_leak_cents': total_leak,
    }
