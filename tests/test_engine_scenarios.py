import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from ai_engine import CareCourtAI
from ai_engine.schemas import CompanyPolicy, CustomerComplaint


def build_engine():
    policies = [
        CompanyPolicy("POL-RET-7", "7 day damaged delivery replacement policy", "Damaged products with photo proof inside 7 days qualify for replacement or refund.", ["damaged_delivery"], "replacement_or_refund", 7, True),
        CompanyPolicy("POL-REF-5", "Refund dispute verification policy", "Refund disputes require order verification and payment ledger review.", ["refund_dispute"], "verify_payment_and_refund_status", 5, False),
        CompanyPolicy("POL-WAR-365", "Warranty repair and replacement policy", "Warranty claims require invoice and serial number during warranty period.", ["warranty_claim"], "repair_or_replacement_under_warranty", 365, True),
    ]
    cases = [
        {"case_id": "OLD-101", "summary": "Cracked product arrived with photo and invoice proof", "resolution": "replacement_or_refund"},
        {"case_id": "OLD-118", "summary": "Refund promised but payment reversal did not arrive", "resolution": "verify_payment_and_refund_status"},
    ]
    return CareCourtAI(policies, cases)


def test_valid_damaged_delivery():
    engine = build_engine()
    decision = engine.analyze(CustomerComplaint(
        customer_name="Riya",
        complaint_text="My order ORD-99421 arrived broken yesterday. I have invoice and photo proof.",
        days_since_delivery=1,
        evidence_count=2,
        order_exists=True,
    ))
    assert decision.case_type == "damaged_delivery"
    assert decision.recommended_resolution == "replacement_or_refund"
    assert decision.verification.risk_label == "low"
    assert decision.human_review_required is False


def test_suspicious_short_claim_requires_review():
    engine = build_engine()
    decision = engine.analyze(CustomerComplaint(
        customer_name="Unknown",
        complaint_text="Fraud company refund now or I go viral",
        order_exists=False,
        evidence_count=0,
        customer_claim_count_30d=4,
    ))
    assert decision.verification.risk_label == "high"
    assert decision.human_review_required is True
    assert decision.recommended_resolution == "request_proof_or_human_review"


def test_policy_window_exception():
    engine = build_engine()
    decision = engine.analyze(CustomerComplaint(
        customer_name="Dev",
        complaint_text="My order ORD-55590 arrived damaged. I have a photo and receipt.",
        days_since_delivery=20,
        evidence_count=2,
        order_exists=True,
    ))
    assert decision.recommended_resolution == "policy_exception_review"
    assert decision.human_review_required is True


if __name__ == "__main__":
    test_valid_damaged_delivery()
    test_suspicious_short_claim_requires_review()
    test_policy_window_exception()
    print("All CareCourt AI scenario tests passed.")
