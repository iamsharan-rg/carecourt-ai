from __future__ import annotations

from .text_tools import SimpleSemanticIndex


class SimilarCaseMemory:
    def __init__(self, resolved_cases: list[dict]):
        self.index = SimpleSemanticIndex([
            {
                "case_id": case["case_id"],
                "text": case["summary"],
                "resolution": case["resolution"],
                "outcome": case.get("outcome", "resolved"),
            }
            for case in resolved_cases
        ])

    def find(self, complaint_text: str, top_k: int = 3) -> list[dict]:
        return self.index.search(complaint_text, top_k=top_k)
