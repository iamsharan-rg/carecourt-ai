from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any


@dataclass
class CustomerComplaint:
    customer_name: str
    complaint_text: str
    issue_type: str | None = None
    order_id: str | None = None
    days_since_delivery: int | None = None
    evidence_count: int = 0
    order_exists: bool | None = None
    customer_claim_count_30d: int = 0
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class CompanyPolicy:
    policy_id: str
    title: str
    text: str
    issue_types: list[str]
    resolution: str
    window_days: int | None = None
    requires_evidence: bool = True


@dataclass
class ParsedComplaint:
    issue_type: str
    emotion: str
    urgency: str
    requested_action: str
    extracted_order_id: str | None
    evidence_signals: list[str]
    pressure_signals: list[str]
    key_facts: list[str]


@dataclass
class VerificationResult:
    risk_score: int
    risk_label: str
    requires_human_review: bool
    reasons: list[str]


@dataclass
class PolicyMatch:
    policy_id: str
    title: str
    score: float
    policy_text: str
    resolution: str
    window_days: int | None
    requires_evidence: bool


@dataclass
class ResolutionDecision:
    case_type: str
    recommended_resolution: str
    confidence: int
    human_review_required: bool
    verification: VerificationResult
    matched_policy: PolicyMatch | None
    parsed_complaint: ParsedComplaint
    reasons: list[str]
    next_actions: list[str]
    customer_reply: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
