from __future__ import annotations

from .schemas import CustomerComplaint, ParsedComplaint, VerificationResult


class VerificationEngine:
    def score(
        self,
        complaint: CustomerComplaint,
        parsed: ParsedComplaint,
        similar_case_scores: list[float] | None = None,
        policy_window_days: int | None = None,
    ) -> VerificationResult:
        risk = 10
        reasons: list[str] = []
        text = complaint.complaint_text.strip()

        if len(text) < 45:
            risk += 20
            reasons.append("Complaint is very short and lacks useful details.")

        if complaint.order_exists is False and not parsed.extracted_order_id:
            risk += 35
            reasons.append("No verified order or order reference is available.")
        elif complaint.order_exists is True or parsed.extracted_order_id:
            risk -= 15
            reasons.append("Order/customer reference is available.")

        total_evidence = complaint.evidence_count + len(parsed.evidence_signals)
        if total_evidence == 0:
            risk += 15
            reasons.append("No supporting evidence was detected.")
        elif total_evidence >= 2:
            risk -= 10
            reasons.append("Multiple evidence signals are available.")
        else:
            reasons.append("Some evidence is available.")

        if complaint.customer_claim_count_30d >= 3:
            risk += 20
            reasons.append("Customer has submitted multiple claims in the last 30 days.")

        if complaint.days_since_delivery is not None and policy_window_days is not None:
            if complaint.days_since_delivery > policy_window_days:
                risk += 18
                reasons.append("Complaint is outside the matched policy window.")
            else:
                risk -= 5
                reasons.append("Complaint is inside the matched policy window.")
        elif complaint.days_since_delivery is not None and complaint.days_since_delivery > 14:
            risk += 10
            reasons.append("Issue was reported long after delivery.")

        if parsed.pressure_signals and total_evidence == 0:
            risk += 15
            reasons.append("Escalation language appears without matching proof.")
        elif parsed.pressure_signals:
            risk += 5
            reasons.append("Escalation language detected.")

        if similar_case_scores and max(similar_case_scores) > 0.92:
            risk += 8
            reasons.append("Highly similar complaint pattern exists in past cases.")

        risk = max(5, min(100, risk))
        label = "high" if risk >= 70 else "medium" if risk >= 40 else "low"
        return VerificationResult(
            risk_score=risk,
            risk_label=label,
            requires_human_review=risk >= 40,
            reasons=reasons,
        )
