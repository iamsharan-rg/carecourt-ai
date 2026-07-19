from __future__ import annotations

import json

from ai_engine import CareCourtAI
from ai_engine.schemas import CompanyPolicy, CustomerComplaint

policies = [
    CompanyPolicy(
        policy_id="POL-RET-7",
        title="7 day damaged delivery replacement policy",
        text="If a product arrives damaged and the customer provides photo proof within 7 days, offer replacement. If replacement is unavailable, offer refund.",
        issue_types=["damaged_delivery"],
        resolution="replacement_or_refund",
        window_days=7,
        requires_evidence=True,
    ),
    CompanyPolicy(
        policy_id="POL-REF-5",
        title="Refund dispute verification policy",
        text="Refund disputes require order verification, payment ledger check, and previous support ticket review before approval.",
        issue_types=["refund_dispute"],
        resolution="verify_payment_and_refund_status",
        window_days=5,
        requires_evidence=False,
    ),
    CompanyPolicy(
        policy_id="POL-WAR-365",
        title="Warranty repair and replacement policy",
        text="Warranty claims require invoice and serial number. Eligible products can be repaired or replaced during the warranty period.",
        issue_types=["warranty_claim"],
        resolution="repair_or_replacement_under_warranty",
        window_days=365,
        requires_evidence=True,
    ),
]

resolved_cases = [
    {
        "case_id": "OLD-101",
        "summary": "Customer received cracked phone case two days after delivery and uploaded photo proof with invoice.",
        "resolution": "replacement_or_refund",
        "outcome": "resolved",
    },
    {
        "case_id": "OLD-118",
        "summary": "Refund was promised by support agent but no payment reversal appeared after five days.",
        "resolution": "verify_payment_and_refund_status",
        "outcome": "resolved",
    },
]

complaint = CustomerComplaint(
    customer_name="Riya Sharma",
    complaint_text="My order ORD-99421 arrived broken yesterday. I contacted support twice and nobody helped me. I have the invoice and photo proof.",
    days_since_delivery=1,
    evidence_count=2,
    order_exists=True,
    customer_claim_count_30d=0,
)

engine = CareCourtAI(policies, resolved_cases)
decision = engine.analyze(complaint)
print(json.dumps(decision.to_dict(), indent=2))
