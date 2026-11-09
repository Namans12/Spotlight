"""Stable identities for source observations, never inferred title equivalence."""
import hashlib
import json


def source_record_key(*parts: object) -> str:
    payload = json.dumps(parts, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()
