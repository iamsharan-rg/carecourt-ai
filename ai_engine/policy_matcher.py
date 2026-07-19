from __future__ import annotations

from .embedding_store import HybridSemanticIndex
from .schemas import CompanyPolicy, PolicyMatch


class PolicyMatcher:
    def __init__(self, policies: list[CompanyPolicy], prefer_embeddings: bool = True):
        self.policies = policies
        self.index = HybridSemanticIndex([
            {
                "policy_id": policy.policy_id,
                "title": policy.title,
                "text": " ".join([policy.title, policy.text, " ".join(policy.issue_types)]),
                "issue_types": policy.issue_types,
                "resolution": policy.resolution,
                "window_days": policy.window_days,
                "requires_evidence": policy.requires_evidence,
            }
            for policy in policies
        ], prefer_embeddings=prefer_embeddings)
        self.retrieval_mode = self.index.mode

    def match(self, complaint_text: str, issue_type: str) -> PolicyMatch | None:
        query = f"{issue_type} {complaint_text}"
        hits = self.index.search(query, top_k=5)
        if not hits:
            return None

        for hit in hits:
            if issue_type in hit["issue_types"]:
                hit["score"] = min(1.0, hit["score"] + 0.25)

        hits.sort(key=lambda item: item["score"], reverse=True)
        hit = hits[0]
        if hit["score"] < 0.08:
            return None

        return PolicyMatch(
            policy_id=hit["policy_id"],
            title=hit["title"],
            score=round(float(hit["score"]), 3),
            policy_text=hit["text"],
            resolution=hit["resolution"],
            window_days=hit["window_days"],
            requires_evidence=hit["requires_evidence"],
        )
