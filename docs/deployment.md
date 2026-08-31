# Deployment

Production deployment uses GitHub Actions -> GitHub OIDC -> Infisical -> Screeps.

No long-lived Infisical credential or Screeps token is stored in GitHub.

## Infisical project

Existing project ID:

`99abd655-8231-4ac2-8af9-ef4dbe556a5d`

The GitHub action requires the project's **slug**, which is available in Infisical project settings.

## 1. Add the Screeps token to Infisical

In the Infisical environment you want GitHub to deploy from, create this path:

`/deploy`

Add one secret there:

`SCREEPS_TOKEN`

Use a persistent Screeps auth token scoped as narrowly as possible. PTR deployment, verification, and activation require access to:

- `POST /ptr/api/user/code` to upload code
- `GET /ptr/api/user/code` to read the uploaded branch back and verify it
- `POST /ptr/api/user/activate-ptr` to request CPU activation after verification
- `GET /ptr/api/user/world-status` to require a normal authenticated PTR account state

Do not add the token to GitHub, the repository, or a local `.env` file.

## 2. Create the GitHub Actions machine identity

In Infisical:

1. Open **Access Control -> Machine Identities** for this project.
2. Create a dedicated identity, e.g. `screeps-2026-github-deploy`.
3. Remove Universal Auth and add **OIDC Auth**.
4. Configure:
   - OIDC Discovery URL: `https://token.actions.githubusercontent.com`
   - Issuer: `https://token.actions.githubusercontent.com`
   - Subject: `repo:jason-merrell@112509082/screeps-2026@1345400327:ref:refs/heads/main`
   - Audience: `https://github.com/jason-merrell`
5. Grant the identity read-only secret access to the chosen environment and `/deploy` path.
6. Copy the Machine Identity ID.

Avoid repository-wide wildcard subjects unless there is a concrete need for them.

## 3. Configure GitHub repository variables

In GitHub, open **Settings -> Secrets and variables -> Actions -> Variables** and create:

| Variable | Value |
| --- | --- |
| `INFISICAL_IDENTITY_ID` | Machine Identity ID from step 2 |
| `INFISICAL_PROJECT_SLUG` | Infisical project slug |
| `INFISICAL_ENV_SLUG` | Environment slug containing `/deploy` |
| `SCREEPS_BRANCH` | Optional. Defaults to `default` |
| `SCREEPS_HOST` | Optional. Defaults to `https://screeps.com` |

These are configuration values, not secret credentials.

## 4. Deploy and verify

`.github/workflows/deploy.yml` runs automatically after a commit lands on `main` and may also be invoked with `workflow_dispatch`.

The workflow:

1. Authenticates to Infisical using a short-lived GitHub OIDC token.
2. Fetches only `/deploy` from Infisical.
3. Runs lint, typecheck, and tests.
4. Builds `dist/main.js`.
5. Uploads that module to the configured Screeps code branch using `X-Token` authentication.
6. Reads the same branch back with `GET /api/user/code`.
7. Compares the returned `main` module byte-for-byte with the local build and fails if they differ.
8. For PTR deployments, requests idempotent activation only after byte verification and requires the authenticated PTR account status to be `normal`. That status is not proof of CPU execution: tick advancement and runtime provenance remain observability-snapshot evidence, not deployment claims.

Verification logs only a short SHA-256 fingerprint of the deployed module, never the module contents or `SCREEPS_TOKEN`.

## Local deployment

Local deployment uses the same scripts as CI. Both expect `SCREEPS_TOKEN` in the process environment, so Infisical CLI injection can be used without creating a plaintext `.env` file.

Deploy:

```bash
infisical run --projectId=99abd655-8231-4ac2-8af9-ef4dbe556a5d --env=dev --path=/deploy -- pnpm run deploy:screeps
```

Verify an existing build:

```bash
infisical run --projectId=99abd655-8231-4ac2-8af9-ef4dbe556a5d --env=dev --path=/deploy -- pnpm run verify:screeps
```

Change the environment to match your Infisical setup.
