# Films on Cue

A film review website with a weekly newsletter and a private dashboard for the owner.

- **Home:** wide black-and-white hero with a newsletter sign-up, then the three latest reviews
- **Reviews:** every review, newest first, with search and filters (genre, rating, year, where to watch, sort)
- **Review pages:** rating, film details, trailer, spoiler warning, and search-engine star ratings
- **About, Contact, Privacy policy** pages, all editable from the dashboard
- **Owner dashboard** (Replit login, locked to your account): write, edit, schedule, promote and delete reviews; manage social links; edit page text; see subscribers and messages; send the newsletter
- **Weekly newsletter** with double opt-in, one-click unsubscribe and automatic sending
- **Contact form** saved to the dashboard and emailed to you, with spam protection

Built with Node.js, Express and PostgreSQL. Everything (including images) is stored in the database, so nothing is lost when the site is republished.

---

## 1. Put it on Replit

1. Go to **replit.com/import**, choose **GitHub**, connect your account if asked, and pick **Films-on-cue**.
2. When the project opens, open the **Database** tool and create a **PostgreSQL** database. Replit adds the `DATABASE_URL` secret for you.
3. Open **Secrets** (the padlock in the Tools list) and add:

   | Secret | What to put |
   | --- | --- |
   | `SESSION_SECRET` | Any long random string (mash the keyboard for 40+ characters) |
   | `OWNER_EMAIL` | The email address of **your Replit account**. Only this account can open the dashboard |

4. Press **Run**. The site starts and the tables are created automatically.
5. Open the site **in a new browser tab** (the arrow icon on the preview pane). Signing in doesn’t work inside the small preview pane, because browsers block its cookies.

## 2. Sign in and add your first review

1. Go to `/login` on your site (for example `https://your-site.replit.app/login`) and choose **Sign in with Replit**.
2. You land on the dashboard. Bookmark it: there’s deliberately no login link on the public site.
3. Go to **Site settings** first: add your Instagram, Facebook and TikTok links, and check the page text.
4. Then **Reviews › Write a review**.

If you see “isn’t the owner account”, the email on your Replit account doesn’t match `OWNER_EMAIL`. The page shows the email you signed in with; copy that into the secret and try again.

## 3. Publish

1. Click **Publish** (or **Deploy**) in Replit and choose **Autoscale**. The build and run commands are already set in `.replit`.
2. Check the deployment has the same secrets as above. Replit usually copies them, but secrets added later must be added to the deployment as well.
3. After it’s live, add a `SITE_URL` secret with the public address, for example `https://films-on-cue.replit.app`, and republish. Email links and share previews use it.

### Your own domain (for example filmsoncue.com)

1. In the deployment’s settings, add your custom domain and follow Replit’s DNS steps.
2. Update secrets: `SITE_URL=https://filmsoncue.com` and `CUSTOM_DOMAINS=filmsoncue.com,www.filmsoncue.com` (this lets the owner login work on that domain).
3. Republish.

## 4. Turn on email (newsletter and message alerts)

The site uses [Resend](https://resend.com) to send email. Until it’s set up, sign-ups are still collected (without a confirmation email) and messages are still saved in the dashboard; nothing is sent.

1. Create a Resend account and **verify your domain** (Resend shows the DNS records to add). Without a verified domain, Resend only lets you send to yourself.
2. Create an API key.
3. Add secrets: `RESEND_API_KEY` = the key, and `EMAIL_FROM` = `Films on Cue <hello@yourdomain.com>` (an address on the verified domain).
4. In **Site settings › Site details**, set **Send contact messages to** (otherwise alerts go to `OWNER_EMAIL`).
5. Republish.

### When the weekly email goes out

Set the day and time on the dashboard’s **Newsletter** page (Friday 09:00 UK time to start). The email includes every review published since the last one, and is skipped in weeks with nothing new. It can never go out twice in the same week.

- **Automatic:** the site checks whenever someone visits, so on a site with regular visitors the email goes out shortly after the set time.
- **Guaranteed timing (optional):** add a Replit **Scheduled Deployment** that runs `npm run digest` a few minutes after your send time each week (for example every Friday at 09:05, UK time). It needs the same secrets.
- **Manual:** use **Send now** on the Newsletter page.

## 5. Optional extras

- **Stronger spam protection:** create a free Cloudflare Turnstile widget and add `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`. The forms already have hidden bot traps and rate limits without it.
- **Outside scheduler:** set `CRON_SECRET` and call `POST /cron/digest` with `Authorization: Bearer <CRON_SECRET>`.

## Images

Use official stills from distributors’ press sites (press kits / EPKs), which are provided for reviews, and credit them in the **Image credit** box. Landscape stills (3:2 or 16:9) look best. On cards they show in black and white, turning to colour on hover; on the review page they’re in full colour.

## Keeping GitHub and Replit in step

Changes made in Replit can be pushed back to GitHub from Replit’s **Git** tool, and changes pushed to GitHub can be pulled in the same way. Your reviews and settings live in the database, not in the code, so they aren’t affected.

---

## For developers

```bash
npm install
cp .env.example .env            # fill in DATABASE_URL, and set DEV_LOGIN=true
npm run local                   # reads .env; DEV_LOGIN lets you sign in on localhost without Replit
```

`DEV_LOGIN` only works on localhost, and never on Replit or in production.

| Path | What’s there |
| --- | --- |
| `src/server.js` | App setup, security headers, sessions |
| `src/auth.js` | Replit Auth (OpenID Connect), owner check, form tokens |
| `src/routes/public.js` | Public pages, newsletter, contact, images, feeds |
| `src/routes/admin.js` | Dashboard |
| `src/lib/` | Reviews, newsletter, email, settings, images, spam checks |
| `src/views/` | EJS templates |
| `src/schema.sql` | Database tables (applied on every start) |
| `public/css/site.css` | Site design |
| `public/art/` | Hero line art, generated by `npm run art` from `scripts/generate-art.cjs` |

Feeds: `/feed.xml` (RSS) and `/sitemap.xml`.

Fonts: Gloock and Schibsted Grotesk (SIL Open Font License, see `public/fonts/`). Social icons: Simple Icons (CC0).
