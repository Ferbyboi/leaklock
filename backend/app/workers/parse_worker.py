import anthropic
import json

client = anthropic.Anthropic()

PARSE_PROMPT = '''
You are a field service data extractor. Given raw technician notes,
extract every distinct item, material, or labor action performed.
Return ONLY valid JSON — no explanation, no markdown.

Schema: [{
  "item": str,       // normalized item name (e.g. "copper pipe 3/4 inch")
  "qty": float,      // quantity if mentioned, else 1.0
  "unit": str,       // "each", "hours", "feet", "lbs", etc.
  "confidence": float // 0.0-1.0 — how certain you are this was done
}]

If no items found, return []. Never add items not mentioned in the text.
'''


def parse_field_notes(raw_text: str) -> list[dict]:
    if not raw_text.strip():
        return []

    msg = client.messages.create(
        model='claude-sonnet-4-6',
        max_tokens=1024,
        messages=[{
            'role': 'user',
            'content': f'{PARSE_PROMPT}\n\nFIELD NOTES:\n{raw_text}'
        }]
    )
    raw = msg.content[0].text.strip()

    # Strip any accidental markdown fences
    if raw.startswith('```'):
        raw = raw.split('```')[1]
    if raw.startswith('json'):
        raw = raw[4:]

    return json.loads(raw.strip())
