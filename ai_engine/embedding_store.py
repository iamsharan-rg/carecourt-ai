from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .text_tools import SimpleSemanticIndex

try:
    import faiss
    import numpy as np
    import torch
    from transformers import AutoModel, AutoTokenizer
    VECTOR_DEPS_AVAILABLE = True
except Exception:
    faiss = None
    np = None
    torch = None
    AutoModel = None
    AutoTokenizer = None
    VECTOR_DEPS_AVAILABLE = False

DEFAULT_MODEL = "sentence-transformers/all-MiniLM-L6-v2"


@dataclass
class RetrievalHit:
    score: float
    text: str
    metadata: dict[str, Any] = field(default_factory=dict)


def mean_pool(last_hidden_state, attention_mask):
    mask = attention_mask.unsqueeze(-1).expand(last_hidden_state.size()).float()
    summed = (last_hidden_state * mask).sum(dim=1)
    counts = mask.sum(dim=1).clamp(min=1e-9)
    return summed / counts


class MiniLMEmbeddingEngine:
    """Your local embedding model adapter: MiniLM + normalized vectors + FAISS-ready output."""

    def __init__(self, model_name: str = DEFAULT_MODEL, device: str | None = None):
        if not VECTOR_DEPS_AVAILABLE:
            raise RuntimeError("Install torch, transformers, numpy, and faiss to use MiniLMEmbeddingEngine.")
        self.model_name = model_name
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.tokenizer = AutoTokenizer.from_pretrained(model_name)
        self.model = AutoModel.from_pretrained(model_name).to(self.device)
        self.model.eval()

    def encode(self, texts: list[str], batch_size: int = 64, max_length: int = 256, normalize: bool = True):
        vectors = []
        for start in range(0, len(texts), batch_size):
            batch = texts[start:start + batch_size]
            encoded = self.tokenizer(batch, padding=True, truncation=True, max_length=max_length, return_tensors="pt")
            encoded = {key: value.to(self.device) for key, value in encoded.items()}
            with torch.no_grad():
                output = self.model(**encoded)
                pooled = mean_pool(output.last_hidden_state, encoded["attention_mask"])
            batch_vectors = pooled.cpu().numpy().astype("float32")
            if normalize:
                faiss.normalize_L2(batch_vectors)
            vectors.append(batch_vectors)
        return np.vstack(vectors).astype("float32")


class EmbeddingSemanticIndex:
    """FAISS semantic search powered by your MiniLM embedding pipeline."""

    def __init__(self, records: list[dict], model_name: str = DEFAULT_MODEL):
        if not VECTOR_DEPS_AVAILABLE:
            raise RuntimeError("Vector dependencies are not available.")
        self.records = records
        self.engine = MiniLMEmbeddingEngine(model_name=model_name)
        texts = [record["text"] for record in records]
        vectors = self.engine.encode(texts, normalize=True)
        dim = vectors.shape[1]
        self.index = faiss.IndexHNSWFlat(dim, 32, faiss.METRIC_INNER_PRODUCT)
        self.index.hnsw.efConstruction = 80
        self.index.hnsw.efSearch = 64
        self.index.add(vectors)

    def search(self, query: str, top_k: int = 3) -> list[dict]:
        vector = self.engine.encode([query], batch_size=1, normalize=True)
        scores, ids = self.index.search(vector, top_k)
        hits = []
        for score, idx in zip(scores[0], ids[0]):
            if idx == -1:
                continue
            hits.append({**self.records[int(idx)], "score": float(score)})
        return hits


class HybridSemanticIndex:
    """Uses your embedding model when available, otherwise falls back to local lexical search."""

    def __init__(self, records: list[dict], prefer_embeddings: bool = True):
        self.mode = "simple"
        self.index = SimpleSemanticIndex(records)
        if prefer_embeddings and VECTOR_DEPS_AVAILABLE:
            try:
                self.index = EmbeddingSemanticIndex(records)
                self.mode = "embedding_faiss"
            except Exception:
                self.index = SimpleSemanticIndex(records)
                self.mode = "simple"

    def search(self, query: str, top_k: int = 3) -> list[dict]:
        return self.index.search(query, top_k=top_k)
