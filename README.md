# Baby Outlet Promotion QR Center

A bilingual-ready (English + Khmer labels) promotion website built for Cloudflare Workers, D1 and R2.

## Features
- Public mobile-friendly promotion listing and individual promotion pages
- Admin password login
- Upload JPG, PNG and PDF (maximum 15 MB)
- Create, edit, delete, publish and unpublish promotions
- Permanent master QR code for the promotions page
- Individual QR codes for each promotion
- Cloudflare D1 database and R2 file storage

## Before you deploy
You need:
- A Cloudflare account
- Your domain's DNS access (keep your existing website DNS records unchanged)
- Node.js installed on your computer
- A terminal / command prompt

## 1. Install tools
Install Node.js LTS from https://nodejs.org/
Open a terminal in this project folder and run:

```bash
npm install
npx wrangler login
```

## 2. Create the database and file bucket
```bash
npx wrangler d1 create baby-outlet-promotions
```
Copy the returned `database_id` into `wrangler.toml`, replacing `REPLACE_WITH_D1_DATABASE_ID`.

Then:
```bash
npx wrangler d1 execute baby-outlet-promotions --remote --file=./schema.sql
npx wrangler r2 bucket create baby-outlet-promotion-files
```

## 3. Set admin password
```bash
npx wrangler secret put ADMIN_PASSWORD
```
Enter a strong, unique password when prompted. Do not put the password in the source files.

## 4. Test locally
```bash
npx wrangler dev
```
Open the local URL shown in the terminal. Go to Admin and sign in with your secret password.

## 5. Deploy
```bash
npx wrangler deploy
```
Cloudflare will provide a `workers.dev` URL. Test customer view and admin upload before connecting your custom domain.

## 6. Connect promotion.babyoutlet.com
In Cloudflare dashboard:
1. Open Workers & Pages and select `baby-outlet-promotion`.
2. Open Settings / Domains & Routes (or Triggers, depending on dashboard layout).
3. Add Custom Domain: `promotion.babyoutlet.com`.
4. Follow Cloudflare's DNS instructions. If your main domain is managed elsewhere, add only the requested subdomain record at that DNS provider. Do not replace nameservers or alter existing root/www records.
5. Wait for HTTPS provisioning and test the domain.

## Important notes
- Master QR destination is the website root (`https://promotion.babyoutlet.com/#promotions`). It does not change when promotions are edited.
- Individual QR destinations use stable promotion IDs (`/#promotion/<id>`). Editing a promotion keeps its QR URL; deleting it makes that QR no longer work.
- Draft promotions are private; only published promotions appear publicly.
- QR generation uses the QRCode.js CDN, so the browser needs internet access when generating codes.
- The admin password is a simple shared-secret login. For a multi-staff production system, consider Cloudflare Access or a proper identity provider.
- This starter app has no upload virus scanning, role-based staff permissions, or audit log. Restrict admin password access.
- Public files are delivered through the Worker only for published promotions.
- Free-plan quotas and product availability can change; check Cloudflare pricing/limits before production use.
