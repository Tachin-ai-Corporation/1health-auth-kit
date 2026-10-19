"""Tests for templates/supabase-fastapi/one_health.py — adapt the import to where the module lives in the repo.

Protocol paths use httpx.MockTransport (no extra deps); route error mapping uses FastAPI's TestClient.
Run: pytest tests/test_one_health.py
"""
import asyncio
import base64
import json
import os
import secrets

import httpx
import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

SECRET, APP_ID = "test-launch-secret-demo-000000", "42"
os.environ.update({
    "SUPABASE_URL": "http://supabase.invalid", "SUPABASE_ANON_KEY": "anon", "SUPABASE_SERVICE_ROLE_KEY": "service",
    "ONE_HEALTH_LINK_COOKIE_SECRET": "x" * 40, "ONE_HEALTH_DEMO_LAUNCH_SECRET": SECRET, "ONE_HEALTH_DEMO_APP_ID": APP_ID,
})
for var in ("ONE_HEALTH_PROD_LAUNCH_SECRET", "ONE_HEALTH_ALLOWED_TENANT_IDS", "ONE_HEALTH_LINK_POLICY", "ONE_HEALTH_APP_ORIGIN"):
    os.environ.pop(var, None)

import one_health as oh  # noqa: E402  ← adapt (e.g. `from app.auth import one_health as oh`)

CODE = "Ab12Cd34Ef56Gh78"


def encrypt_bytes(plaintext: bytes, secret=SECRET) -> str:
    key = HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=None).derive(secret.encode())
    iv = secrets.token_bytes(12)
    return base64.b64encode(iv + AESGCM(key).encrypt(iv, plaintext, None)).decode()


def encrypt(obj, secret=SECRET) -> str:
    return encrypt_bytes(json.dumps(obj).encode(), secret)


def payload(code=CODE, tenant=7, user=9):
    return {"required": {"apiKey": {"name": "k"}, "tenant": {"id": tenant}, "user": {"id": user}, "oneTimeCode": {"value": code}},
            "optional": {"user_first_name": "Jane"}}


def fake_jwt(claims) -> str:
    import jwt  # PyJWT rejects malformed segments, so mint a real (test-key) JWT; the module never verifies it
    return jwt.encode(claims, "test-key-not-1health-" + "0" * 16, algorithm="HS256")


def use_transport(monkeypatch, handler):
    real = httpx.AsyncClient
    seen = {}

    def client(**kw):
        seen.update(kw)
        return real(transport=httpx.MockTransport(handler), **kw)
    monkeypatch.setattr(oh.httpx, "AsyncClient", client)
    return seen


def one_health(myself, claims=None, token_status=200):
    def handler(req: httpx.Request):
        if req.url.path.endswith("/user/token"):
            body = json.loads(req.content)
            assert body["signature"] == oh.sign_code(SECRET, body["securityCode"])
            return httpx.Response(token_status, json={"access_token": fake_jwt(claims or {"externalApplicationId": 42})})
        if isinstance(myself, Exception):
            raise myself
        return myself if isinstance(myself, httpx.Response) else httpx.Response(200, json=myself)
    return handler


def resolve(lpl):
    return asyncio.run(oh.resolve_launch(lpl))


# ── decrypt & sign ─────────────────────────────────────────────────────────────────────────────
def test_decrypt_detects_env():
    r = oh.decrypt_launch_payload(encrypt(payload()))
    assert (r["env"], r["tenant_id"], r["user_id"], r["code"]) == ("demo", "7", "9", CODE)


def test_hmac_known_vector():
    # Same vector as the TS protocol test (cross-checked with `openssl dgst -sha256 -hmac`).
    assert oh.sign_code(SECRET, CODE) == "TTRi4Lro/NcbBlyM7ERttoCASE1ly+AsX19ds2MZiRg="


@pytest.mark.parametrize("lpl", [
    "AAAA", "not base64!",
    encrypt(payload(), "other-secret-xxxxxxxxxx"),        # wrong secret / other environment
    encrypt(payload("short")),                            # malformed one-time code
    encrypt_bytes(b"not json"),                           # decrypts, but plaintext isn't JSON
    encrypt_bytes(b"\xff\xfe"),                           # decrypts, but plaintext isn't UTF-8
    encrypt([1, 2]),                                      # JSON, but not an object
    encrypt({"required": {}}),                            # missing fields
    encrypt(payload(tenant=None)),                        # null tenant id
    encrypt(payload(user=None)),                          # null user id
])
def test_decrypt_rejects(lpl):
    with pytest.raises(oh.LaunchError, match="payload_invalid"):
        oh.decrypt_launch_payload(lpl)


# ── resolve_launch ─────────────────────────────────────────────────────────────────────────────
def test_resolve_ok(monkeypatch):
    seen = use_transport(monkeypatch, one_health({"email": " Jane@Example.com ", "emailVerified": True}))
    r = resolve(encrypt(payload()))
    assert (r["email"], r["first_name"]) == ("jane@example.com", "Jane")
    assert seen["timeout"] == oh.TIMEOUT_S  # every 1health call is bounded


@pytest.mark.parametrize("myself,claims,code", [
    ({"email": "a@b.co", "emailVerified": True}, {"externalApplicationId": 99}, "wrong_application"),
    ({"email": "a@b.co", "emailVerified": False}, None, "email_not_verified"),
    ({"email": "a@b.co"}, None, "email_not_verified"),
    ({"email": "system_1health_qa-manager", "emailVerified": True}, None, "identity_no_email"),  # demo QA users
    ({"emailVerified": True}, None, "identity_no_email"),
    (httpx.Response(500), None, "identity_lookup_failed"),
    (httpx.Response(200, text="<html>"), None, "identity_lookup_failed"),           # non-JSON /myself
    (httpx.Response(200, json=["a@b.co"]), None, "identity_lookup_failed"),         # non-object /myself
    (httpx.ConnectError("down"), None, "identity_lookup_failed"),
    (httpx.ReadTimeout("slow"), None, "identity_lookup_failed"),                    # timeout
])
def test_resolve_errors(monkeypatch, myself, claims, code):
    use_transport(monkeypatch, one_health(myself, claims))
    with pytest.raises(oh.LaunchError, match=code):
        resolve(encrypt(payload()))


@pytest.mark.parametrize("response", [
    httpx.Response(200, json={"access_token": "not-a-jwt"}),   # non-JWT token
    httpx.Response(400, json={"message": "code already used"}),
    httpx.Response(200, text="<html>"),
    httpx.Response(200, json={"access_token": None}),
    httpx.ConnectTimeout("slow"),                               # timeout
    httpx.ConnectError("down"),
])
def test_token_exchange_errors(monkeypatch, response):
    def handler(req):
        if isinstance(response, Exception):
            raise response
        return response
    use_transport(monkeypatch, handler)
    with pytest.raises(oh.LaunchError, match="token_exchange_failed"):
        resolve(encrypt(payload()))


def test_tenant_allow_list(monkeypatch):
    use_transport(monkeypatch, one_health({"email": "a@b.co", "emailVerified": True}))
    monkeypatch.setattr(oh, "ALLOWED_TENANTS", {"demo:8"})
    with pytest.raises(oh.LaunchError, match="tenant_not_allowed"):
        resolve(encrypt(payload()))
    monkeypatch.setattr(oh, "ALLOWED_TENANTS", {"demo:7"})
    assert resolve(encrypt(payload()))["tenant_id"] == "7"


# ── routes ─────────────────────────────────────────────────────────────────────────────────────
@pytest.fixture
def client(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    app = FastAPI()
    app.include_router(oh.router)
    monkeypatch.setattr(oh, "audit", lambda *a, **k: None)
    monkeypatch.setattr(oh, "_hits", oh.defaultdict(oh.deque))
    return TestClient(app, follow_redirects=False)


IDENTITY = {"env": "demo", "tenant_id": "7", "user_id": "9", "email": "a@b.co"}


def test_routes_map_errors(client, monkeypatch):
    assert client.get("/1health/launch").headers["location"].endswith("error=launch_missing")
    assert client.get("/1health/launch", params={"lpl": "AAAA"}).headers["location"].endswith("error=payload_invalid")

    async def ok(_):
        return IDENTITY
    monkeypatch.setattr(oh, "resolve_launch", ok)
    monkeypatch.setattr(oh, "find_app_user", lambda _: (_ for _ in ()).throw(RuntimeError("db down")))
    r = client.get("/1health/launch", params={"lpl": "x"})
    assert r.status_code == 303 and r.headers["location"].endswith("error=launch_failed")
    monkeypatch.setattr(oh, "find_app_user", lambda _: None)
    r = client.get("/1health/launch", params={"lpl": "x"})
    assert r.headers["location"] == "/register?source=1health" and "oh_pending_link" in r.headers["set-cookie"]


def test_launch_signs_in_existing_user(client, monkeypatch):
    async def ok(_):
        return IDENTITY
    monkeypatch.setattr(oh, "resolve_launch", ok)
    monkeypatch.setattr(oh, "find_app_user", lambda _: {"id": "u1", "email": "a@b.co", "linked": True})
    monkeypatch.setattr(oh, "mint_supabase_session", lambda _: {"access_token": "at", "refresh_token": "rt"})
    monkeypatch.setattr(oh, "APP_ORIGIN", "https://app.example.com")  # split API / SPA origins
    r = client.get("/1health/launch", params={"lpl": "x"})
    assert r.headers["location"] == "https://app.example.com/#access_token=at&refresh_token=rt"


def test_launch_rate_limited(client, monkeypatch):
    monkeypatch.setitem(oh.RATE_LIMITS, "launch", (2, 60))
    codes = [client.get("/1health/launch").headers["location"].rsplit("=", 1)[1] for _ in range(3)]
    assert codes == ["launch_missing", "launch_missing", "rate_limited"]


def test_registration_errors_use_message(client, monkeypatch):
    # OneHealthRegistration reads `data.message`, so errors must not use FastAPI's `detail`.
    r = client.post("/1health/complete-registration", json={"name": "Jane", "password": "long-enough"})
    assert r.status_code == 400 and r.json() == {"message": "Your 1health launch expired. Open the app from 1health again."}
    assert client.get("/1health/pending").json() == {"message": "No pending 1health link"}

    client.cookies.set(oh.PENDING_COOKIE, oh._signer.dumps(IDENTITY))
    r = client.post("/1health/complete-registration", json={"name": "Jane", "password": "short"})
    assert r.status_code == 400 and "8 characters" in r.json()["message"]
    assert client.get("/1health/pending").json() == {"email": "a@b.co", "firstName": None, "lastName": None}

    monkeypatch.setitem(oh.RATE_LIMITS, "complete-registration", (0, 60))
    r = client.post("/1health/complete-registration", json={"name": "Jane", "password": "long-enough"})
    assert r.status_code == 429 and "message" in r.json()
