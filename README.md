# CareCourt AI Engine

A custom customer-dispute resolution engine for the FlowZint AI Hackathon idea.

CareCourt AI is not a normal chatbot. It parses a complaint, checks verification risk, matches company policy, compares past cases, and recommends a fair resolution with explainable reasons.

## Run the demo

```bash
pip install -r requirements.txt
python app.py
```

Then open http://127.0.0.1:8000/.

To check the backend is actually running (not just the browser fallback), visit
http://127.0.0.1:8000/api/health — you should see `"status": "ok"`.

## Core modules

- `complaint_parser.py`: detects issue type, emotion, evidence, order ID, urgency, and requested action.
- `verification.py`: gives a verification risk score without directly calling a customer fake.
- `policy_matcher.py`: matches complaint text against company policies.
- `case_memory.py`: finds similar resolved cases.
- `resolution_engine.py`: combines all signals into a decision.

## Later integrations

- Replace `SimpleSemanticIndex` with your embedding tool + FAISS.
- Store policies, cases, decisions, and audit logs in PostgreSQL.
- Expose `CareCourtAI.analyze()` through FastAPI.
