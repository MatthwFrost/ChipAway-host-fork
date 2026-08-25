# Deploying ChipAway to GitHub Pages

The React port is deployed by the workflow in `.github/workflows/deploy-pages.yml`.

## One-time setup

1. Open the repository on GitHub and choose **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Merge or push the application to `main`.

Every push to `main` installs the locked dependencies, runs lint and tests, builds the app, and publishes the `dist` folder. The deployment status is visible under the repository’s **Actions** tab.

## Local production check

```bash
npm ci
npm run lint
npm test
npm run build
npm run preview
```

Netlify uses the same `npm run build` command and publishes the same `dist` folder.
