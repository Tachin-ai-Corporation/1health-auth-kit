"""Tests for templates/supabase-fastapi/one_health.py — adapt the import to where the module lives in the repo.

Protocol paths use httpx.MockTransport (no extra deps); route error mapping uses FastAPI's TestClient.
Run: pytest tests/test_one_health.py
"""
import asyncio
import base64
import hashlib
import hmac
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
os.environ.pop("ONE_HEALTH_PROD_LAUNCH_SECRET", None)

import one_health as oh  # noqa: E402  ← adapt (e.g. `from app.auth import one_health as oh`)


def encrypt(obj, secret=SECRET) -> str:
    key = HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=None).derive(secret.encode())
    iv = secrets.token_bytes(12)
    return base64.b64encode(iv + AESGCM(key).encrypt(iv, json.dumps(obj).encode(), None)).decode()


def payload(code="Ab12Cd34Ef56Gh78"):
    return {"required": {"apiKey": {"name": "k"}, "tenant": {"id": 7}, "user": {"id": 9}, "oneTimeCode": {"value": code}},
            "optional": {"user_first_name": "Jane"}}


def fake_jwt(claims) -> str:
    import jwt  # PyJWT rejects malformed segments, so mint a real (test-key) JWT; the module never verifies it
    return jwt.encode(claims, "test-key-not-1health", algorithm="HS256")


def use_transport(monkeypatch, handler):
    real = httpx.AsyncClient
    monkeypatch.setattr(oh.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))


def one_health(myself, claims=None, token_status=200):
    def handler(req: httpx.Request):
        if req.url.path.endswith("/user/token"):
            body = json.loads(req.content)
            assert body["signature"] == base64.b64encode(
                hmac.new(SECRET.encode(), body["securityCode"].encode(), hashlib.sha256).digest()).decode()
            return httpx.Response(token_status, json={"access_token": fake_jwt(claims or {"externalApplicationId": 42})})
        if isinstance(myself, Exception):
            raise myself
        return myself if isinstance(myself, httpx.Response) else httpx.Response(200, json=myself)
    return handler


def resolve(lpl):
    return asyncio.run(oh.resolve_launch(lpl))


def test_decrypt_detects_env():
    r = oh.decrypt_launch_payload(encrypt(payload()))
    assert (r["env"], r["tenant_id"], r["user_id"], r["code"]) == ("demo", "7", "9", "Ab12Cd34Ef56Gh78")


@pytest.mark.parametrize("lpl", ["AAAA", "not base64!", encrypt(payload(), "other-secret-xxxxxxxxxx"), encrypt(payload("short"))])
def test_decrypt_rejects(lpl):
    with pytest.raises(oh.LaunchError, match="payload_invalid"):
        oh.decrypt_launch_payload(lpl)


def test_resolve_ok(monkeypatch):
    use_transport(monkeypatch, one_health({"email": " Jane@Example.com ", "emailVerified": True}))
    assert resolve(encrypt(payload()))["email"] == "jane@example.com"


@pytest.mark.parametrize("myself,claims,code", [
    ({"email": "a@b.co", "emailVerified": True}, {"externalApplicationId": 99}, "wrong_application"),
    ({"email": "a@b.co", "emailVerified": False}, None, "email_not_verified"),
    ({"email": "system_1health_qa-manager", "emailVerified": True}, None, "identity_no_email"),  # demo QA users
    (httpx.Response(500), None, "identity_lookup_failed"),
    (httpx.Response(200, text="<html>"), None, "identity_lookup_failed"),
    (httpx.ConnectError("down"), None, "identity_lookup_failed"),
])
def test_resolve_errors(monkeypatch, myself, claims, code):
    use_transport(monkeypatch, one_health(myself, claims))
    with pytest.raises(oh.LaunchError, match=code):
        resolve(encrypt(payload()))


def test_non_jwt_token(monkeypatch):
    use_transport(monkeypatch, lambda req: httpx.Response(200, json={"access_token": "not-a-jwt"}))
    with pytest.raises(oh.LaunchError, match="token_exchange_failed"):
        resolve(encrypt(payload()))


def test_routes_map_errors(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    app = FastAPI()
    app.include_router(oh.router)
    monkeypatch.setattr(oh, "audit", lambda *a, **k: None)
    c = TestClient(app, follow_redirects=False)
    assert c.get("/1health/launch").headers["location"].endswith("error=launch_missing")
    assert c.get("/1health/launch", params={"lpl": "AAAA"}).headers["location"].endswith("error=payload_invalid")

    async def ok(_):
        return {"env": "demo", "tenant_id": "7", "user_id": "9", "email": "a@b.co"}
    monkeypatch.setattr(oh, "resolve_launch", ok)
    monkeypatch.setattr(oh, "find_app_user", lambda _: (_ for _ in ()).throw(RuntimeError("db down")))
    r = c.get("/1health/launch", params={"lpl": "x"})
    assert r.status_code == 303 and r.headers["location"].endswith("error=launch_failed")
    monkeypatch.setattr(oh, "find_app_user", lambda _: None)
    assert c.get("/1health/launch", params={"lpl": "x"}).headers["location"].endswith("source=1health")
