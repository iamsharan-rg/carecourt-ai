from __future__ import annotations

import math
import re
from collections import Counter

STOPWORDS = {
    "a", "an", "the", "and", "or", "but", "to", "of", "in", "on", "for", "with",
    "is", "are", "was", "were", "be", "been", "i", "me", "my", "we", "our", "you",
    "your", "it", "this", "that", "from", "as", "at", "by", "not", "no", "please"
}


def tokenize(text: str) -> list[str]:
    words = re.findall(r"[a-zA-Z0-9]+", text.lower())
    return [word for word in words if word not in STOPWORDS and len(word) > 1]


def contains_phrase(text: str, phrase: str) -> bool:
    pattern = r"(?<![a-zA-Z0-9])" + re.escape(phrase.lower()) + r"(?![a-zA-Z0-9])"
    return re.search(pattern, text.lower()) is not None


def cosine_similarity(left: Counter[str], right: Counter[str]) -> float:
    if not left or not right:
        return 0.0
    common = set(left) & set(right)
    dot = sum(left[token] * right[token] for token in common)
    left_norm = math.sqrt(sum(value * value for value in left.values()))
    right_norm = math.sqrt(sum(value * value for value in right.values()))
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return dot / (left_norm * right_norm)


class SimpleSemanticIndex:
    """Small local semantic index. Replace with FAISS/user embeddings later if needed."""

    def __init__(self, records: list[dict]):
        self.records = records
        self.vectors = [Counter(tokenize(record["text"])) for record in records]

    def search(self, query: str, top_k: int = 3) -> list[dict]:
        query_vector = Counter(tokenize(query))
        scored = []
        for record, vector in zip(self.records, self.vectors):
            scored.append({**record, "score": cosine_similarity(query_vector, vector)})
        scored.sort(key=lambda item: item["score"], reverse=True)
        return scored[:top_k]
