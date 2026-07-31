# Getting ChipAway onto GitHub Pages

This covers only the GitHub side. Netlify comes later, once this part works. By the end you'll have a live link:

```
https://tommmmiller.github.io/ChipAway/
```

Everything below assumes you're starting from nothing — no git installed, no repo created. Follow it in order. It'll take about 15 minutes.

I'm going to use **GitHub Desktop** rather than the command line. It's a free app with buttons instead of typed commands, and it removes the one step (login authentication) that trips people up most. If you'd rather use the command line, say so and I'll give you that version instead.

---

## Part 1 — Get the files onto your computer

You already have the zip file I gave you (`poker-trainer-site.zip`, or whatever you renamed it). Handle it first, GitHub second.

1. Find the zip file — it's probably in your **Downloads** folder.
2. **Double-click it to unzip.** On macOS this creates a folder automatically. On Windows, right-click it and choose **Extract All…**, then confirm.
3. You now have a folder containing these files — check they're all there:
   - `index.html`
   - `README.md`
   - `LICENSE`
   - `netlify.toml`
   - `404.html`
   - `preview.png`
   - `.gitignore` (this one may be invisible — see box below)
   - a `local` folder with three launcher files inside
4. **Rename this folder to `ChipAway`** — right-click it → Rename. Matching the folder name to the repo name isn't required, but it avoids confusion later.
5. Move this folder somewhere permanent — not Downloads, since it can get cleared out. I'd suggest creating a folder called `Projects` in your Documents folder, and putting `ChipAway` inside that. So the path looks like:
   - macOS: `/Users/YOU/Documents/Projects/ChipAway`
   - Windows: `C:\Users\YOU\Documents\Projects\ChipAway`

> **A note on `.gitignore`:** this file starts with a dot, which means macOS and Windows hide it by default. Don't worry about seeing it — it doesn't need to be visible, it just needs to be *inside* the folder, and unzipping should have put it there correctly. If you want to check: macOS Finder → press `Cmd+Shift+.` to toggle hidden files; Windows Explorer → View tab → tick "Hidden items".

---

## Part 2 — Create your GitHub account (skip if you already have one)

1. Go to **[github.com/signup](https://github.com/signup)**
2. Enter an email, password, and choose a username — you've already got one, **tommmmiller**, so just log in if the account exists.
3. Verify your email if asked.

---

## Part 3 — Create the ChipAway repository on GitHub.com

Do this on the website first, before touching any app.

1. Go to **[github.com/new](https://github.com/new)**
2. **Repository name:** type exactly `ChipAway`
3. Leave it set to **Public** (this is required — free GitHub Pages hosting doesn't work on private repos)
4. **Do not tick any of the three boxes** — "Add a README file", "Add .gitignore", "Choose a license". You already have all three in your folder, and ticking these creates files on GitHub that conflict with the ones you're about to upload.
5. Click the green **Create repository** button.

You'll land on a page with setup instructions in grey boxes — ignore all of that, it's for command-line use. Just leave this tab open.

---

## Part 4 — Install GitHub Desktop

1. Go to **[desktop.github.com](https://desktop.github.com/)**
2. Click the download button for your operating system (it auto-detects Mac vs Windows)
3. Open the downloaded installer and follow the prompts — accept the defaults throughout
4. When it opens for the first time, click **Sign in to GitHub.com**, and log in as **tommmmiller** in the browser window that pops up
5. It'll ask for your name and email for commits — use your GitHub email, this is just for labelling, not important

---

## Part 5 — Add your ChipAway folder as a repository

1. In GitHub Desktop, go to the menu: **File → Add Local Repository**
2. Click **Choose…** and navigate to the `ChipAway` folder you created in Part 1 (e.g. `Documents/Projects/ChipAway`)
3. Select that folder and click **Add Repository**

GitHub Desktop will likely say *"This directory does not appear to be a Git repository"* and offer to **create a repository here** — click that option, then **Create Repository** in the dialog that follows. Leave the settings as they are.

You should now see GitHub Desktop showing a list of all your files under a **"Changes"** tab, each with a checkmark next to it — this is it detecting everything in the folder for the first time.

---

## Part 6 — Publish it

1. At the bottom left, there's a text box labelled **Summary**. Type something like `First upload of ChipAway`
2. Click the blue **Commit to main** button just below it
3. At the top of the window, click the blue **Publish repository** button
4. A dialog appears asking for the name and whether it's private. **Important:** change the name field to exactly `ChipAway` (matching what you created on GitHub.com in Part 3), untick **"Keep this code private"**, then click **Publish Repository**

That's the code uploaded. You can check it worked by going to `github.com/tommmmiller/ChipAway` in your browser — refresh the page, and you should see all your files listed.

> **If it complains the repository already exists / names don't match:** this happens if GitHub Desktop tries to create a *new* repo instead of pushing to the one you made in Part 3. If so, instead of clicking Publish, go to **Repository → Repository Settings → Remote**, and set the remote URL to `https://github.com/tommmmiller/ChipAway.git`, then use **Repository → Push** instead. Tell me if you hit this and I'll walk you through the exact fix.

---

## Part 7 — Turn on GitHub Pages

Now tell GitHub to actually host it as a website.

1. Go to `github.com/tommmmiller/ChipAway`
2. Click **Settings** (top right of the repo, in the row of tabs — Code, Issues, Pull requests, Actions, Settings…)
3. In the left sidebar, click **Pages**
4. Under **"Build and deployment"** → **Source**, make sure it says **"Deploy from a branch"**
5. Under **Branch**, there are two dropdowns. Set the first to **main** and the second to **/ (root)**
6. Click **Save**

A message appears saying your site is being built. This takes **1 to 3 minutes**. Refresh the Settings → Pages screen after a couple of minutes and a green box will appear saying:

> Your site is live at `https://tommmmiller.github.io/ChipAway/`

Click it. That's ChipAway, live, on the internet, playable by anyone with that link.

---

## Checking it actually works

Open the link on your phone too, not just your laptop — since you're sharing this with friends, worth confirming it looks right on mobile. Everything should render identically, since it's the same file either way.

---

## What to do when you change something later

Any time you edit `index.html` (or I send you an updated version):

1. Replace the file in your `ChipAway` folder with the new version
2. Open **GitHub Desktop** — it will automatically show the file as changed
3. Type a short summary of what changed, click **Commit to main**
4. Click **Push origin** (the button that was "Publish repository" now just says "Push origin")
5. Wait about a minute — GitHub Pages automatically rebuilds and the live link updates itself. No need to touch Settings again.

---

## If something goes wrong

| Symptom | What to check |
|---|---|
| Pages screen won't show a green "live" box | Wait 5 full minutes, then hard-refresh the Settings → Pages page (Cmd+Shift+R / Ctrl+Shift+R) |
| Live link shows a 404 | Confirm `index.html` sits directly inside the ChipAway folder, not inside a subfolder — check on github.com/tommmmiller/ChipAway that you can see `index.html` listed at the top level |
| GitHub Desktop shows no changes to commit | You may have added the repository from the wrong folder — check the path shown at the top of GitHub Desktop matches your ChipAway folder |
| Publish button greyed out | You need to commit first (Part 6, step 2) before you can publish |

If you hit anything not covered here, tell me exactly what's on screen and I'll walk through it with you.

---

## Next: Netlify

Once `https://tommmmiller.github.io/ChipAway/` is live and working, say the word and I'll give you the Netlify half — that's the one with the feedback form switched on, and the nicer URL to actually send your friends.
