"""
1health launch SSO for a FastAPI + Supabase app.

Routes (mount with app.include_router(one_health.router)):
  GET  /1health/launch                 ← the URL registered in 1health
  GET  /1health/pending                → prefill for registration
  POST /1health/complete-registration  {name, password}
  POST /1health/confirm-link           (confirm-first-link: call after a normal sign-in, Bearer = app session)

Session delivery: redirect to "/#access_token=…&refresh_token=…&expires_in=…&token_type=bearer&type=magiclink".
The frontend boot code stores both tokens the way the app already stores its session and clears the fragment.

Requires: cryptography, httpx, PyJWT, itsdangerous, supabase (with auth client that has verify_otp token_hash).
Adapt: settings access, PROFILE_TABLE, SIGN_IN / SIGN_UP paths, password rules, post-sign-up work.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import re
from typing import Optional
from urllib.parse import urlencode

import httpx
import jwt  # PyJWT
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse
from itsdangerous import BadSignature, URLSafeTimedSerializer
from pydantic import BaseModel
from supabase import Client, create_client

log = logging.getLogger("one_health")
router = APIRouter()

# ── configuration (adapt to the repo's settings module) ────────────────────────────────────────
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY") or os.environ["SUPABASE_KEY"]
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
LINK_COOKIE_SECRET = os.environ["ONE_HEALTH_LINK_COOKIE_SECRET"]
LINK_POLICY = os.environ.get("ONE_HEALTH_LINK_POLICY", "auto-link")
ALLOWED_TENANTS = {t.strip() for t in os.environ.get("ONE_HEALTH_ALLOWED_TENANT_IDS", "").split(",") if t.strip()}
ENVIRONMENTS = {
    "demo": {"base": "https://demo.1health.io", "secret": os.environ.get("ONE_HEALTH_DEMO_LAUNCH_SECRET"), "app_id": os.environ.get("ONE_HEALTH_DEMO_APP_ID")},
    "prod": {"base": "https://app.1health.io",  "secret": os.environ.get("ONE_HEALTH_PROD_LAUNCH_SECRET"), "app_id": os.environ.get("ONE_HEALTH_PROD_APP_ID")},
}
PROFILE_TABLE = "profiles"   # ← table whose `id` equals auth.users.id
SIGN_IN, SIGN_UP, HOME = "/login", "/register", "/"   # ← adapt
PENDING_COOKIE, PENDING_TTL_S = "oh_pending_link", 15 * 60
_OTC = re.compile(r"^[A-Za-z0-9]{16}$")
# /myself can return a username in `email` with emailVerified: true (observed for demo QA/system users).
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
TIMEOUT_S = 10


def _with_param(path: str, key: str, value: str) -> str:
    """Append a query param to a path that may already carry a query string."""
    return f'{path}{"&" if "?" in path else "?"}{urlencode({key: value})}'


_signer = URLSafeTimedSerializer(LINK_COOKIE_SECRET, salt="one-health-pending-link")


class LaunchError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _admin() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


# ── protocol ───────────────────────────────────────────────────────────────────────────────────
def _key(secret: str) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=None).derive(secret.encode("utf-8"))


def decrypt_launch_payload(lpl: str) -> dict:
    try:
        raw = base64.b64decode(lpl, validate=True)
    except ValueError:
        raise LaunchError("payload_invalid")
    if len(raw) < 28:
        raise LaunchError("payload_invalid")
    for env, cfg in ENVIRONMENTS.items():
        if not cfg["secret"]:
            continue
        try:
            data = json.loads(AESGCM(_key(cfg["secret"])).decrypt(raw[:12], raw[12:], None))
        except InvalidTag:
            continue
        try:
            req = data["required"]
            code = req["oneTimeCode"]["value"]
            out = {"env": env, "tenant_id": str(req["tenant"]["id"]), "user_id": str(req["user"]["id"]),
                   "code": code, "optional": data.get("optional") or {}}
        except (KeyError, TypeError):
            raise LaunchError("payload_invalid")
        if not isinstance(code, str) or not _OTC.fullmatch(code):
            raise LaunchError("payload_invalid")
        return out
    raise LaunchError("payload_invalid")


async def resolve_launch(lpl: str) -> dict:
    launch = decrypt_launch_payload(lpl)
    cfg = ENVIRONMENTS[launch["env"]]
    sig = base64.b64encode(hmac.new(cfg["secret"].encode(), launch["code"].encode(), hashlib.sha256).digest()).decode()
    async with httpx.AsyncClient(timeout=TIMEOUT_S) as c:
        try:
            r = await c.post(f'{cfg["base"]}/api/v2/public/external-application/auth/oauth2/user/token',
                             json={"securityCode": launch["code"], "signature": sig})
            access_token = r.json().get("access_token") if r.status_code == 200 else None
        except (httpx.HTTPError, ValueError, AttributeError):
            access_token = None
        if not isinstance(access_token, str) or not access_token:
            raise LaunchError("token_exchange_failed")
        try:
            claims = jwt.decode(access_token, options={"verify_signature": False})  # /myself proves validity
        except jwt.PyJWTError:
            raise LaunchError("token_exchange_failed")
        if str(claims.get("externalApplicationId")) != str(cfg["app_id"]):
            raise LaunchError("wrong_application")
        try:
            me_res = await c.get(f'{cfg["base"]}/api/v2/user/myself', headers={"Authorization": f"Bearer {access_token}"})
            me = me_res.json() if me_res.status_code == 200 else None
        except (httpx.HTTPError, ValueError):
            me = None
    if not isinstance(me, dict):
        raise LaunchError("identity_lookup_failed")
    email = str(me.get("email") or "").strip().lower()
    if not _EMAIL.match(email):
        raise LaunchError("identity_no_email")
    if me.get("emailVerified") is not True:
        raise LaunchError("email_not_verified")
    if ALLOWED_TENANTS and f'{launch["env"]}:{launch["tenant_id"]}' not in ALLOWED_TENANTS:
        raise LaunchError("tenant_not_allowed")
    opt = launch["optional"]
    return {"env": launch["env"], "tenant_id": launch["tenant_id"], "user_id": launch["user_id"], "email": email,
            "first_name": opt.get("user_first_name") or me.get("firstName"),
            "last_name": opt.get("user_last_name") or me.get("lastName")}


# ── users & sessions ───────────────────────────────────────────────────────────────────────────
def find_app_user(identity: dict) -> Optional[dict]:
    db = _admin()
    linked = (db.table(PROFILE_TABLE).select("id")
              .eq("one_health_env", identity["env"]).eq("one_health_tenant_id", identity["tenant_id"])
              .eq("one_health_user_id", identity["user_id"]).limit(1).execute()).data
    if linked:
        u = db.auth.admin.get_user_by_id(linked[0]["id"]).user
        if u and u.email:
            return {"id": u.id, "email": u.email, "linked": True}
    user_id = db.rpc("auth_user_id_by_email", {"p_email": identity["email"]}).execute().data
    if not user_id:
        return None
    row = db.table(PROFILE_TABLE).select("one_health_user_id").eq("id", user_id).limit(1).execute().data
    if row and row[0].get("one_health_user_id"):
        raise LaunchError("identity_conflict")
    return {"id": user_id, "email": identity["email"], "linked": False}


def link_identity(user_id: str, identity: dict) -> None:
    _admin().table(PROFILE_TABLE).update({
        "one_health_env": identity["env"], "one_health_tenant_id": identity["tenant_id"],
        "one_health_user_id": identity["user_id"],
    }).eq("id", user_id).execute()


def mint_supabase_session(email: str) -> dict:
    link = _admin().auth.admin.generate_link({"type": "magiclink", "email": email})  # sends no email
    anon = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)                           # fresh client per call
    s = anon.auth.verify_otp({"token_hash": link.properties.hashed_token, "type": "magiclink"}).session
    if not s:
        raise LaunchError("session_mint_failed")
    return {"access_token": s.access_token, "refresh_token": s.refresh_token,
            "expires_in": s.expires_in, "token_type": "bearer", "type": "magiclink"}


def audit(outcome: str, identity: Optional[dict] = None, reason: Optional[str] = None, app_user_id: Optional[str] = None):
    try:
        _admin().table("one_health_launch_audit").insert({
            "outcome": outcome, "failure_reason": reason,
            "one_health_env": (identity or {}).get("env"), "one_health_tenant_id": (identity or {}).get("tenant_id"),
            "one_health_user_id": (identity or {}).get("user_id"), "app_user_id": app_user_id,
        }).execute()
    except Exception:  # never block sign-in on audit
        log.warning("one_health audit insert failed")


# ── pending-link cookie ────────────────────────────────────────────────────────────────────────
def _set_pending(resp, identity: dict):
    resp.set_cookie(PENDING_COOKIE, _signer.dumps(identity), max_age=PENDING_TTL_S,
                    httponly=True, secure=True, samesite="lax", path="/")


def _read_pending(request: Request) -> Optional[dict]:
    raw = request.cookies.get(PENDING_COOKIE)
    if not raw:
        return None
    try:
        return _signer.loads(raw, max_age=PENDING_TTL_S)
    except BadSignature:
        return None


# ── routes ─────────────────────────────────────────────────────────────────────────────────────
@router.get("/1health/launch")
async def one_health_launch(lpl: Optional[str] = None):
    identity = None
    try:
        if not lpl:
            raise LaunchError("launch_missing")
        identity = await resolve_launch(lpl)
        user = find_app_user(identity)
        if user is None:
            audit("no_user", identity)
            resp = RedirectResponse(_with_param(SIGN_UP, "source", "1health"), 303)
            _set_pending(resp, identity)
            return resp
        if not user["linked"]:
            if LINK_POLICY == "confirm-first-link":
                audit("pending_confirm", identity)
                resp = RedirectResponse(_with_param(SIGN_IN, "source", "1health"), 303)
                _set_pending(resp, identity)
                return resp
            link_identity(user["id"], identity)
        session = mint_supabase_session(user["email"])
        audit("success", identity, app_user_id=user["id"])
        return RedirectResponse(f"{HOME}#{urlencode(session)}", 303)
    except Exception as e:  # LaunchError codes, plus a friendly page for unexpected DB/Supabase errors
        code = e.code if isinstance(e, LaunchError) else "launch_failed"
        if not isinstance(e, LaunchError):
            log.exception("one_health launch failed")  # never log lpl, tokens or /myself bodies
        audit("failure", identity, reason=code)
        return RedirectResponse(_with_param(SIGN_IN, "error", code), 303)


@router.get("/1health/pending")
async def one_health_pending(request: Request):
    p = _read_pending(request)
    if not p:
        raise HTTPException(404, "No pending 1health link")
    return {"email": p["email"], "firstName": p.get("first_name"), "lastName": p.get("last_name")}


class CompleteRegistration(BaseModel):
    name: str
    password: str


@router.post("/1health/complete-registration")
async def one_health_complete_registration(body: CompleteRegistration, request: Request):
    p = _read_pending(request)
    if not p:
        raise HTTPException(400, "Your 1health launch expired. Open the app from 1health again.")
    if not body.name.strip() or len(body.password) < 8:   # ← match the repo's password rules
        raise HTTPException(400, "Enter your name and a password of at least 8 characters.")
    try:
        created = _admin().auth.admin.create_user({
            "email": p["email"], "password": body.password, "email_confirm": True,  # 1health verified the email
            "user_metadata": {"name": body.name.strip()},
        })
    except Exception as exc:
        if "already" in str(exc).lower():
            raise HTTPException(409, "An account with this email already exists. Sign in instead.")
        raise HTTPException(400, "Registration failed.")
    # ← Run the repo's normal post-sign-up work here (profile row, defaults, welcome email).
    link_identity(created.user.id, p)
    session = mint_supabase_session(p["email"])
    audit("success", p, app_user_id=created.user.id)
    resp = JSONResponse({"redirectTo": f"{HOME}#{urlencode(session)}"})
    resp.delete_cookie(PENDING_COOKIE, path="/")
    return resp


@router.post("/1health/confirm-link")
async def one_health_confirm_link(request: Request, authorization: str = Header("")):
    """confirm-first-link: call right after a normal sign-in, with the app's Supabase access token."""
    p = _read_pending(request)
    if not p:
        return {"linked": False}
    token = authorization.removeprefix("Bearer ").strip()
    user = _admin().auth.get_user(token).user if token else None
    if not user or (user.email or "").lower() != p["email"]:
        raise HTTPException(403, "Signed-in user does not match the 1health identity")
    link_identity(user.id, p)
    audit("success", p, app_user_id=user.id)
    resp = JSONResponse({"linked": True})
    resp.delete_cookie(PENDING_COOKIE, path="/")
    return resp
