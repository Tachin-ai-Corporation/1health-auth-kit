# FastAPI reference: verification project

Runs the skill's FastAPI template as shipped. `one_health.py` and `test_one_health.py` are symlinks into
`skill/1health-launch-sso/templates/`.

```bash
cd reference/fastapi
python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt
pytest -q          # 14 tests: protocol paths (httpx.MockTransport) + route error mapping (TestClient)
```

Not covered: Supabase calls (`generate_link`, `verify_otp`, `admin.create_user`) and the frontend fragment
handling. These need a real or local Supabase project.
