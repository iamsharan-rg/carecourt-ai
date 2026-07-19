from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from ai_engine import CareCourtAI
from ai_engine.embedding_store import VECTOR_DEPS_AVAILABLE
from ai_engine.schemas import CompanyPolicy, CustomerComplaint

ROOT = Path(__file__).resolve().parent
frontend = ROOT / "frontend"

POLICIES = [
    CompanyPolicy("POL-RET-7", "7 day damaged delivery replacement policy", "Damaged products with photo proof inside 7 days qualify for replacement or refund.", ["damaged_delivery"], "replacement_or_refund", 7, True),
    CompanyPolicy("POL-REF-5", "Refund dispute verification policy", "Refund disputes require order verification and payment ledger review.", ["refund_dispute"], "verify_payment_and_refund_status", 5, False),
    CompanyPolicy("POL-WAR-365", "Warranty repair and replacement policy", "Warranty claims require invoice and serial number during warranty period.", ["warranty_claim"], "repair_or_replacement_under_warranty", 365, True),
    CompanyPolicy("POL-SLA-3", "Delivery delay service recovery policy", "Delayed deliveries require courier check and compensation review if the SLA was missed.", ["delivery_delay"], "delivery_status_check_and_compensation_if_needed", 3, False),
    CompanyPolicy("POL-CAN-14", "Subscription cancellation policy", "Cancellation requests must be confirmed within 14 days; retention review applies to active plans.", ["cancellation"], "confirm_cancellation_or_retention_review", 14, False),
]

RESOLVED_CASES = [
    {"case_id": "OLD-101", "summary": "Cracked product arrived with photo and invoice proof", "resolution": "replacement_or_refund"},
    {"case_id": "OLD-118", "summary": "Refund promised but payment reversal did not arrive", "resolution": "verify_payment_and_refund_status"},
    {"case_id": "OLD-141", "summary": "Courier delay crossed promised delivery SLA and customer requested compensation", "resolution": "delivery_status_check_and_compensation_if_needed"},
    {"case_id": "OLD-162", "summary": "Warranty repair requested with valid invoice and serial number inside warranty period", "resolution": "repair_or_replacement_under_warranty"},
    {"case_id": "OLD-177", "summary": "Customer asked to cancel subscription plan before renewal date", "resolution": "confirm_cancellation_or_retention_review"},
]

ENGINE = CareCourtAI(POLICIES, RESOLVED_CASES)

app = FastAPI(title="CareCourt AI")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# IMPORTANT: API routes must be defined BEFORE the "/" static mount below.
# FastAPI/Starlette matches routes in the order they are registered, and a
# StaticFiles mount at "/" matches every path. If it were registered first,
# it would swallow /api/health and /api/analyze and always return 404.


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "mode": "python",
        "embedding_dependencies_available": VECTOR_DEPS_AVAILABLE,
        "retrieval_mode": ENGINE.policy_matcher.retrieval_mode,
    }


@app.post("/api/analyze")
async def analyze(request: Request):
    body = await request.body()
    payload = json.loads(body.decode("utf-8") or "{}") if body else {}
    complaint = CustomerComplaint(
        customer_name=payload.get("customer_name", "Customer"),
        complaint_text=payload.get("complaint_text", ""),
        issue_type=payload.get("issue_type"),
        order_id=payload.get("order_id"),
        days_since_delivery=payload.get("days_since_delivery"),
        evidence_count=payload.get("evidence_count", 0),
        order_exists=payload.get("order_exists"),
        customer_claim_count_30d=payload.get("customer_claim_count_30d", 0),
    )
    decision = ENGINE.analyze(complaint)
    return JSONResponse(content=decision.to_dict())


# Static file mounts go LAST, after all /api/* routes above.
app.mount("/frontend", StaticFiles(directory=str(frontend), html=True), name="frontend_alias")
app.mount("/", StaticFiles(directory=str(frontend), html=True), name="frontend_root")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)
