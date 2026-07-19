from __future__ import annotations

import re

from .schemas import CustomerComplaint, ParsedComplaint
from .text_tools import contains_phrase

ISSUE_KEYWORDS = {
    "damaged_delivery": ["broken", "damaged", "cracked", "torn", "defective", "leaking"],
    "refund_dispute": ["refund", "money back", "charged", "payment", "deducted", "money deducted"],
    "warranty_claim": ["warranty", "repair", "service center", "guarantee", "replacement", "serial number"],
    "missed_promise": ["promised", "callback", "call back", "follow up", "ignored", "no response"],
    "delivery_delay": ["late", "delay", "not delivered", "delivery", "shipment", "courier"],
    "cancellation": ["cancel", "cancellation", "subscription", "stop plan"],
}

ISSUE_ALIASES = {
    "damaged delivery": "damaged_delivery",
    "damaged_delivery": "damaged_delivery",
    "refund dispute": "refund_dispute",
    "refund_dispute": "refund_dispute",
    "warranty claim": "warranty_claim",
    "warranty_claim": "warranty_claim",
    "missed promise": "missed_promise",
    "missed_promise": "missed_promise",
    "delivery delay": "delivery_delay",
    "delivery_delay": "delivery_delay",
    "cancellation": "cancellation",
}

EVIDENCE_WORDS = ["photo", "image", "video", "invoice", "receipt", "screenshot", "proof", "bill", "serial"]
PRESSURE_WORDS = ["viral", "legal", "court", "police", "media", "expose", "consumer forum"]
ANGRY_WORDS = ["angry", "furious", "worst", "fraud", "scam", "cheated", "terrible", "useless"]


class ComplaintParser:
    def parse(self, complaint: CustomerComplaint) -> ParsedComplaint:
        text = complaint.complaint_text.lower()
        issue_type = self._normalize_issue_type(complaint.issue_type) or self._detect_issue_type(text)
        evidence = [word for word in EVIDENCE_WORDS if contains_phrase(text, word)]
        pressure = [word for word in PRESSURE_WORDS if contains_phrase(text, word)]
        order_id = complaint.order_id or self._extract_order_id(complaint.complaint_text)
        emotion = self._emotion(text)
        urgency = "high" if pressure or emotion == "angry" else "medium" if "again" in text or "twice" in text else "normal"
        requested_action = self._requested_action(text)

        facts = []
        if order_id:
            facts.append(f"Order reference found: {order_id}")
        if evidence:
            facts.append("Customer mentions evidence: " + ", ".join(evidence))
        if "twice" in text or "again" in text:
            facts.append("Customer indicates repeated contact")

        return ParsedComplaint(
            issue_type=issue_type,
            emotion=emotion,
            urgency=urgency,
            requested_action=requested_action,
            extracted_order_id=order_id,
            evidence_signals=evidence,
            pressure_signals=pressure,
            key_facts=facts,
        )

    def _normalize_issue_type(self, issue_type: str | None) -> str | None:
        if not issue_type:
            return None
        return ISSUE_ALIASES.get(issue_type.strip().lower().replace("-", " "))

    def _detect_issue_type(self, text: str) -> str:
        scores = {issue: sum(1 for word in words if contains_phrase(text, word)) for issue, words in ISSUE_KEYWORDS.items()}
        best_issue, best_score = max(scores.items(), key=lambda item: item[1])
        return best_issue if best_score else "general_complaint"

    def _extract_order_id(self, text: str) -> str | None:
        match = re.search(r"\b(?:order|ord|id)[#:\s-]*([A-Z0-9][A-Z0-9-]{4,})\b", text, flags=re.IGNORECASE)
        return match.group(1).upper() if match else None

    def _emotion(self, text: str) -> str:
        if any(contains_phrase(text, word) for word in ANGRY_WORDS):
            return "angry"
        if any(phrase in text for phrase in ["confused", "not sure", "unclear"]):
            return "confused"
        if any(contains_phrase(text, word) for word in ["please", "help", "kindly"]):
            return "calm"
        return "neutral"

    def _requested_action(self, text: str) -> str:
        if "refund" in text or "money back" in text:
            return "refund"
        if "replace" in text or "replacement" in text:
            return "replacement"
        if "repair" in text or "service" in text:
            return "repair"
        if "cancel" in text:
            return "cancellation"
        return "fair_resolution"
