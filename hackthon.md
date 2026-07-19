# Hackthon Reference File

## AI Name
CareCourt AI

## What We Are Building
CareCourt AI is a custom AI dispute-resolution engine for customer care. It is not a normal chatbot. It investigates customer complaints using evidence, company policy, similar past cases, verification risk, and fairness scoring before recommending a resolution.

## Problem Statement
Companies receive customer complaints about refunds, damaged products, warranty claims, missed promises, delivery issues, and service failures. Normal chatbots can reply politely, but they do not verify evidence, check policy, compare past cases, detect suspicious claims, or recommend a fair business decision. This creates slow support, unfair decisions, repeated escalations, and loss of customer trust.

## Proposed Solution
CareCourt AI converts each complaint into a structured dispute case. It parses the complaint, detects the issue type and emotion, checks whether the complaint has enough evidence, matches the right company policy, searches similar resolved cases, calculates verification risk, and recommends a fair resolution for human approval.

## Why It Is Different From A Normal Chatbot
Normal chatbots answer messages. CareCourt AI runs a decision workflow. It does not blindly accept or reject complaints. It explains the decision using policy, evidence, case history, and risk signals.

## Current AI Engine Modules
- Complaint Parser: extracts issue type, order ID, evidence signals, pressure language, emotion, urgency, and requested action.
- Verification Engine: produces a verification risk score and flags cases needing human review.
- Policy Matcher: matches complaint text to the most relevant company policy.
- Similar Case Memory: finds previous cases with related patterns.
- Fair Resolution Engine: recommends replacement, refund, repair, proof request, policy exception review, or escalation.

## Bugs Found And Corrected
- Fixed loose issue-type handling so UI values like "Damaged delivery" normalize to "damaged_delivery".
- Fixed keyword matching to avoid weak substring matches.
- Fixed order ID extraction by adding word boundaries.
- Improved policy matching so the detected issue type boosts the correct policy.
- Added matched policy window checks, so late complaints can become policy exception reviews.
- Improved verification scoring with a realistic baseline and minimum risk floor instead of allowing overly perfect zero-risk results.
- Added scenario tests for valid claims, suspicious claims, and policy-window exceptions.

## Tech Stack
- Frontend: React or static HTML/CSS/JS for the first hackathon demo.
- Backend: Python FastAPI.
- Database: PostgreSQL only; no Supabase.
- AI Engine: Custom Python decision engine.
- Retrieval: Current simple semantic index, later replaceable with your embedding tool and FAISS.
- Storage: PostgreSQL tables for companies, customers, policies, cases, decisions, evidence, and audit logs.
- Deployment Option: Local PostgreSQL for demo, Docker or Neon later if hosted database is needed.

## Current Files
- work/carecourt-ai/ai_engine/complaint_parser.py
- work/carecourt-ai/ai_engine/verification.py
- work/carecourt-ai/ai_engine/policy_matcher.py
- work/carecourt-ai/ai_engine/case_memory.py
- work/carecourt-ai/ai_engine/resolution_engine.py
- work/carecourt-ai/tests/test_engine_scenarios.py
- work/carecourt-ai/sample_output.json

## Next Step
Connect this AI engine to a small FastAPI backend, then connect the website dashboard to the backend so companies can submit and review cases.

## Latest Testing Update
- Added direct runnable scenario tests in `work/carecourt-ai/tests/test_engine_scenarios.py`.
- Added three test cases: clean damaged delivery, suspicious pressure claim, and late policy-window exception.
- Python execution is blocked in this Codex environment, so the test file is ready for local execution with `python tests/test_engine_scenarios.py`.

## Website Integration Update
- Added a working CareCourt AI web dashboard in `work/carecourt-ai/frontend`.
- Added a user-facing copy in `outputs/carecourt-ai` that can open directly from `index.html`.
- Added FastAPI backend in `work/carecourt-ai/backend/main.py` with `/api/analyze` and `/api/health`.
- Added `ai_engine/embedding_store.py`, which plugs in your MiniLM + FAISS embedding model when dependencies are installed.
- The website has a browser AI fallback, so the demo still works even if the backend or embedding packages are not running.
- PostgreSQL remains the planned database layer; Supabase is not used.
