# Better Auth reference: verification project

Runs the skill's templates **as shipped**. `lib/one-health/*` and `tests/*` are symlinks into
`skill/1health-launch-sso/templates/`, so the skill, this project and white paper 02 can't drift apart.

```bash
cd reference/better-auth
npx pnpm@10 install
npx pnpm@10 test        # 31 tests: protocol unit tests + plugin e2e through auth.handler
npx pnpm@10 typecheck   # tsconfig target ES6 on purpose (catches top-level await in tests)
```

`better-auth` is pinned to the version the plugin's internal-adapter calls were verified on. To check a new
version, bump it here, then run the tests before updating the docs.
