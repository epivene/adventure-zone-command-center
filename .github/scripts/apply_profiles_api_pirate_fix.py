from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def patch_profile_schema() -> None:
    path = ROOT / "artifacts/api-server/src/features/organizations/profile-touch-schema.ts"
    source = path.read_text(encoding="utf-8")
    anchor = """    await client.query(`\n      ALTER TABLE organizations\n        ADD COLUMN IF NOT EXISTS last_worked_at timestamptz;"""
    replacement = """    await client.query(`\n      ALTER TABLE organizations\n        ADD COLUMN IF NOT EXISTS filler boolean DEFAULT false NOT NULL;\n\n      ALTER TABLE organizations\n        ADD COLUMN IF NOT EXISTS filler_reason text;\n\n      ALTER TABLE organizations\n        ADD COLUMN IF NOT EXISTS filler_changed_at timestamptz;\n\n      ALTER TABLE organizations\n        DROP CONSTRAINT IF EXISTS organizations_filler_reason_required;\n\n      ALTER TABLE organizations\n        ADD CONSTRAINT organizations_filler_reason_required\n        CHECK (NOT filler OR nullif(btrim(filler_reason), '') IS NOT NULL);\n\n      ALTER TABLE organizations\n        ADD COLUMN IF NOT EXISTS last_worked_at timestamptz;"""
    if source.count(anchor) != 1:
        raise RuntimeError("profile-touch schema anchor was not found exactly once")
    path.write_text(source.replace(anchor, replacement), encoding="utf-8")


def write_pirate_outcome() -> None:
    path = ROOT / "imports/approved-profiles/pirate-fest-northglenn-co-2026.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["importRevision"] = 3
    payload["profile"]["description"] = (
        "Pirate Fest did not move forward with Adventure Zone for 2026 because of budget and space limitations. "
        "Michael Ringling remains interested in working together in a future year. Keep 2026 as declined and retain "
        "one early-2027 relationship follow-up."
    )
    payload["booking"].update(
        {
            "status": "declined",
            "nextActionKind": "renewal",
            "nextActionDueAt": "2027-01-15",
            "travelLegId": None,
        }
    )
    payload["notes"] = [
        {
            "subject": "Pirate Fest 2026 declined / future interest",
            "body": (
                "On the August 28 follow-up call, Michael said Pirate Fest would not use Adventure Zone in 2026 "
                "because of budget and space limitations, but he wanted to work together in the future. Remove the "
                "incorrect signed-contract/confirmed-booking narrative. Keep one January 2027 reminder and ask about "
                "Pirate Fest 2027 and the possible July 4 standalone opportunity."
            ),
        }
    ]
    payload["followUps"] = [
        {
            "label": "Reconnect with Michael Ringling for Pirate Fest 2027",
            "reason": (
                "Pirate Fest passed for 2026 because of budget and space limitations, but Michael expressed interest "
                "in working with Adventure Zone in 2027. Ask about Pirate Fest 2027 and the possible July 4 standalone opportunity."
            ),
            "dueAt": "2027-01-15T15:00:00.000Z",
        }
    ]
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    patch_profile_schema()
    write_pirate_outcome()
