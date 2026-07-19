from __future__ import annotations

from .case_memory import SimilarCaseMemory
from .complaint_parser import ComplaintParser
from .policy_matcher import PolicyMatcher
from .schemas import CompanyPolicy, CustomerComplaint, ResolutionDecision
from .verification import VerificationEngine


class FairResolutionEngine:
    def decide(self, complaint: CustomerComplaint, parsed, verification, policy_match, similar_cases: list[dict]) -> tuple[str, int, list[str], list[str]]:
        reasons: list[str] = []
        actions: list[str] = []
        confidence = 55

        if policy_match:
            reasons.append(f"Matched policy: {policy_match.title}.")
            confidence += int(policy_match.score * 20)
        else:
            reasons.append("No strong policy match was found.")
            actions.append("Ask company staff to select the correct policy.")

        if verification.risk_label == "high":
            return "request_proof_or_human_review", 62, reasons + verification.reasons, ["Request missing proof", "Send to senior support agent"]

        if policy_match and complaint.days_since_delivery is not None and policy_match.window_days is not None:
            if complaint.days_since_delivery > policy_match.window_days:
                return "policy_exception_review", 64, reasons + verification.reasons + ["Case is outside the normal policy window."], actions + ["Check whether goodwill exception is allowed", "Escalate if customer history is valuable"]

        if verification.risk_label == "medium":
            confidence -= 10
            actions.append("Human should verify before final decision.")

        if similar_cases:
            best = similar_cases[0]
            if best["score"] > 0.25:
                reasons.append(f"Similar case {best['case_id']} was resolved as: {best['resolution']}.")
                confidence += 8

        if policy_match and policy_match.requires_evidence and complaint.evidence_count == 0 and not parsed.evidence_signals:
            return "request_evidence", max(50, confidence - 10), reasons + ["Policy requires evidence before resolution."], actions + ["Ask customer for photo, invoice, or screenshot"]

        if parsed.issue_type == "damaged_delivery":
            resolution = "replacement_or_refund"
            actions += ["Approve replacement if stock is available", "Offer refund if replacement is unavailable"]
        elif parsed.issue_type == "refund_dispute":
            resolution = "verify_payment_and_refund_status"
            actions += ["Check payment ledger", "Share refund timeline with customer"]
        elif parsed.issue_type == "warranty_claim":
            resolution = "repair_or_replacement_under_warranty"
            actions += ["Verify invoice and warranty window", "Create repair/replacement ticket"]
        elif parsed.issue_type == "missed_promise":
            resolution = "priority_escalation_with_apology"
            actions += ["Escalate to team lead", "Send apology and new deadline"]
        elif parsed.issue_type == "delivery_delay":
            resolution = "delivery_status_check_and_compensation_if_needed"
            actions += ["Check courier status", "Offer compensation if SLA was missed"]
        elif parsed.issue_type == "cancellation":
            resolution = "confirm_cancellation_or_retention_review"
            actions += ["Check billing state", "Confirm cancellation timeline"]
        else:
            resolution = policy_match.resolution if policy_match else "human_review"
            actions.append("Review case manually")

        if parsed.emotion == "angry":
            actions.append("Use empathetic reply and avoid defensive language")
            confidence -= 3

        confidence = max(45, min(96, confidence))
        return resolution, confidence, reasons + verification.reasons, actions


class CareCourtAI:
    def __init__(self, policies: list[CompanyPolicy], resolved_cases: list[dict]):
        self.parser = ComplaintParser()
        self.verifier = VerificationEngine()
        self.policy_matcher = PolicyMatcher(policies)
        self.case_memory = SimilarCaseMemory(resolved_cases)
        self.resolver = FairResolutionEngine()

    def analyze(self, complaint: CustomerComplaint) -> ResolutionDecision:
        parsed = self.parser.parse(complaint)
        policy_match = self.policy_matcher.match(complaint.complaint_text, parsed.issue_type)
        similar_cases = self.case_memory.find(complaint.complaint_text)
        similar_scores = [case["score"] for case in similar_cases]
        verification = self.verifier.score(
            complaint,
            parsed,
            similar_scores,
            policy_window_days=policy_match.window_days if policy_match else None,
        )
        resolution, confidence, reasons, actions = self.resolver.decide(
            complaint, parsed, verification, policy_match, similar_cases
        )
        human_review = verification.requires_human_review or confidence < 70 or resolution in {"request_proof_or_human_review", "human_review", "policy_exception_review"}
        reply = self._customer_reply(complaint.customer_name, resolution, human_review)

        return ResolutionDecision(
            case_type=parsed.issue_type,
            recommended_resolution=resolution,
            confidence=confidence,
            human_review_required=human_review,
            verification=verification,
            matched_policy=policy_match,
            parsed_complaint=parsed,
            reasons=reasons,
            next_actions=actions,
            customer_reply=reply,
        )

    def _customer_reply(self, name: str, resolution: str, human_review: bool) -> str:
        if resolution == "request_evidence":
            return f"Hi {name}, we can help review this quickly. Please upload a photo, invoice, or screenshot so the team can verify the claim."
        if resolution == "request_proof_or_human_review":
            return f"Hi {name}, your case needs a verification review. Please share the missing order or proof details so we can process it fairly."
        if resolution == "policy_exception_review":
            return f"Hi {name}, your case is outside the normal policy window, so our team will review whether an exception is possible."
        if human_review:
            return f"Hi {name}, your case has been sent for review with the relevant policy and complaint details attached."
        return f"Hi {name}, based on the available details, your case is eligible for the recommended resolution: {resolution.replace('_', ' ')}."
