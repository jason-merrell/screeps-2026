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

Use a persistent Screeps auth token scoped as narrowly as possible. The deployer only needs permission to write code through `POST /api/user/code`.

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

## 4. Deploy

`.github/workflows/deploy.yml` runs automatically after a commit lands on `main` and may also be invoked with `workflow_dispatch`.

The workflow:

1. Authenticates to Infisical using a short-lived GitHub OIDC token.
2. Fetches only `/deploy` from Infisical.
3. Runs lint, typecheck, and tests.
4. Builds `dist/main.js`.
5. Uploads that module to the configured Screeps code branch using `X-Token` authentication.

The deploy script never prints `SCREEPS_TOKEN`.

## Local deployment

Local deployment uses the same `pnpm deploy` command. The command expects `SCREEPS_TOKEN` in the process environment, so Infisical CLI injection can be used without creating a plaintext `.env` file.

Example:

```bash
infisical run --projectId=99abd655-8231-4ac2-8af9-ef4dbe556a5d --env=dev --path=/deploy -- pnpm deploy
```

Change the environment to match your Infisical setup.
