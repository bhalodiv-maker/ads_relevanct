# Store & query relevance dashboards

Static HTML dashboards (Chart.js) for R0, AIS, and query-level analysis.

## Backup copy

Before Git was initialized, a full duplicate of this project was created at:

**`/Users/bhalodi.v/store_query_relevance_BACKUP`**

Keep that folder as a safety copy, or refresh it manually before risky changes (`cp -a` from this repo).

## Git author (before pushing)

This repo uses **local** `user.name` / `user.email` for commits. Update them to match your GitHub identity:

```bash
cd "/path/to/store&query_relevance"
git config user.name "Your Name"
git config user.email "your.email@example.com"
```

To fix the last commit author after changing the above:

```bash
git commit --amend --reset-author --no-edit
```

## Files your team needs to open

- **2026 (main):** open `2026_relevance_dashboard.html` in a browser, or use the GitHub Pages URL once published (see below).
- **Dependencies (same folder):** `2026_dashboard_data.js`, `query_ais_embed.js`, optional `flipkart_logo.png`.

## Share via GitHub + GitHub Pages (recommended for internal static sharing)

### 1. Create a repository on GitHub

1. Log in at [github.com](https://github.com) → **New repository**.
2. Name it (e.g. `relevance-dashboard`), choose **Private** if data is sensitive.
3. Do **not** add README/license on GitHub if you will push an existing folder (avoids merge conflicts).

### 2. Push (this repo is already initialized with `main`)

**Why the AI couldn’t push:** automated runs here have no GitHub login (no browser, no saved token). Run the next step **in Cursor’s terminal or Terminal.app** on your Mac, where your GitHub connection can supply credentials.

**One command** (after you create an **empty** repo on GitHub — no README):

```bash
cd "/Users/bhalodi.v/store&query_relevance"
./scripts/connect_and_push.sh https://github.com/YOUR_USERNAME/YOUR_REPO.git
```

Use your real username and repo name. For **SSH**:

```bash
./scripts/connect_and_push.sh git@github.com:YOUR_USERNAME/YOUR_REPO.git
```

Manual equivalent:

```bash
cd "/Users/bhalodi.v/store&query_relevance"
git remote add origin https://github.com/YOUR_ORG/YOUR_REPO.git   # or set-url if origin exists
git push -u origin main
```

If `git push` asks for a password, use a **Personal Access Token** (GitHub → Settings → Developer settings → PAT) as the password, or install [GitHub CLI](https://cli.github.com/) and run `gh auth login` once.

### 3. Turn on GitHub Pages

1. Repo → **Settings** → **Pages**.
2. **Build and deployment** → Source: **Deploy from a branch**.
3. Branch: **main**, folder: **/ (root)** → Save.
4. After ~1–2 minutes, the site is at:

   `https://YOUR_ORG.github.io/YOUR_REPO/` → opens the dashboard via **`index.html`** (redirect).

   Or open the file directly:  
   `https://YOUR_ORG.github.io/YOUR_REPO/2026_relevance_dashboard.html`

### 4. Share the link

Send the full URL to the HTML file (not only the repo root), unless you add an `index.html` that redirects or embeds the dashboard.

## Regenerating data (optional)

From `_archive/`:

```bash
python3 build_2026_dashboard.py
```

Writes `2026_dashboard_data.js` in the project root. Commit and push after regenerating.

## Large files

`query_ais_embed.js` is large; GitHub allows files under 100 MB. If you ever hit limits, use [Git LFS](https://git-lfs.github.com/) or host the asset elsewhere and load it via URL (requires a small code change and CORS-aware hosting).
