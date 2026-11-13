
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  }
});

function authorized(req, env) {
  return !!env.ADMIN_PASSWORD &&
    req.headers.get("x-admin-password") === env.ADMIN_PASSWORD;
}

function validImageUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "https:" && !!url.hostname;
  } catch {
    return false;
  }
}

function imageName(value) {
  try {
    return decodeURIComponent(new URL(value).pathname.split("/").pop() || "poster");
  } catch {
    return "poster";
  }
}

async function handle(req, env) {
  const url = new URL(req.url);
  const path = url.pathname;

  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
        "access-control-allow-headers": "content-type,x-admin-password"
      }
    });
  }

  if (path === "/api/health") {
    return json({ ok: true, site: env.SITE_NAME || "Baby Outlet" });
  }

  if (path === "/api/promotions" && req.method === "GET") {
    const admin = url.searchParams.get("admin") === "1" &&
      authorized(req, env);

    const q = admin
      ? await env.DB.prepare(
          "SELECT * FROM promotions ORDER BY updated_at DESC"
        ).all()
      : await env.DB.prepare(
          "SELECT id,title,description,starts_at,ends_at,status,file_name,file_type,file_key FROM promotions WHERE status='published' ORDER BY starts_at DESC"
        ).all();

    return json(q.results || []);
  }

  // Display poster using its public image URL.
  // No R2 storage is used.
  if (path.startsWith("/api/file/") && req.method === "GET") {
    const id = decodeURIComponent(path.slice("/api/file/".length));

    const row = await env.DB.prepare(
      "SELECT file_key,status FROM promotions WHERE id=?"
    ).bind(id).first();

    if (!row || row.status !== "published" ||
        !validImageUrl(row.file_key)) {
      return new Response("Not found", { status: 404 });
    }

    return Response.redirect(row.file_key, 302);
  }

  if (path === "/api/admin/login" && req.method === "POST") {
    const body = await req.json();

    return body.password === env.ADMIN_PASSWORD && !!env.ADMIN_PASSWORD
      ? json({ ok: true })
      : json({ error: "Incorrect password" }, 401);
  }

  if (path.startsWith("/api/admin/")) {
    if (!authorized(req, env)) {
      return json({ error: "Unauthorized. Please sign in again." }, 401);
    }

    // CREATE PROMOTION
    if (path === "/api/admin/promotions" && req.method === "POST") {
      const form = await req.formData();

      const id = crypto.randomUUID();
      const title = String(form.get("title") || "").trim();
      const description = String(form.get("description") || "");
      const starts = String(form.get("starts_at") || "");
      const ends = String(form.get("ends_at") || "");
      const imageUrl = String(form.get("image_url") || "").trim();

      if (!title || !starts || !ends || ends < starts) {
        return json({ error: "Enter a title and valid dates." }, 400);
      }

      if (!validImageUrl(imageUrl)) {
        return json({
          error: "Please enter a valid HTTPS poster image URL."
        }, 400);
      }

      const now = new Date().toISOString();

      await env.DB.prepare(
        "INSERT INTO promotions (id,title,description,starts_at,ends_at,status,file_key,file_name,file_type,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
      ).bind(
        id,
        title,
        description,
        starts,
        ends,
        "draft",
        imageUrl,
        imageName(imageUrl),
        "image/url",
        now,
        now
      ).run();

      return json({ ok: true, id });
    }

    // EDIT OR DELETE PROMOTION
    const match = path.match(/^\/api\/admin\/promotions\/([^/]+)$/);

    if (match) {
      const id = decodeURIComponent(match[1]);

      if (req.method === "PUT") {
        const form = await req.formData();

        const title = String(form.get("title") || "").trim();
        const description = String(form.get("description") || "");
        const starts = String(form.get("starts_at") || "");
        const ends = String(form.get("ends_at") || "");

        if (!title || !starts || !ends || ends < starts) {
          return json({ error: "Check the title and dates." }, 400);
        }

        const old = await env.DB.prepare(
          "SELECT * FROM promotions WHERE id=?"
        ).bind(id).first();

        if (!old) {
          return json({ error: "Promotion not found" }, 404);
        }

        const imageUrl = String(form.get("image_url") || "").trim();

        let key = old.file_key;
        let name = old.file_name;
        let type = old.file_type;

        if (imageUrl) {
          if (!validImageUrl(imageUrl)) {
            return json({
              error: "Please enter a valid HTTPS poster image URL."
            }, 400);
          }

          key = imageUrl;
          name = imageName(imageUrl);
          type = "image/url";
        }

        await env.DB.prepare(
          "UPDATE promotions SET title=?,description=?,starts_at=?,ends_at=?,file_key=?,file_name=?,file_type=?,updated_at=? WHERE id=?"
        ).bind(
          title,
          description,
          starts,
          ends,
          key,
          name,
          type,
          new Date().toISOString(),
          id
        ).run();

        return json({ ok: true });
      }

      if (req.method === "DELETE") {
        await env.DB.prepare(
          "DELETE FROM promotions WHERE id=?"
        ).bind(id).run();

        return json({ ok: true });
      }
    }

    // PUBLISH
    const pub = path.match(
      /^\/api\/admin\/promotions\/([^/]+)\/publish$/
    );

    if (pub && req.method === "POST") {
      await env.DB.prepare(
        "UPDATE promotions SET status='published',updated_at=? WHERE id=?"
      ).bind(
        new Date().toISOString(),
        decodeURIComponent(pub[1])
      ).run();

      return json({ ok: true });
    }

    // UNPUBLISH
    const unpub = path.match(
      /^\/api\/admin\/promotions\/([^/]+)\/unpublish$/
    );

    if (unpub && req.method === "POST") {
      await env.DB.prepare(
        "UPDATE promotions SET status='draft',updated_at=? WHERE id=?"
      ).bind(
        new Date().toISOString(),
        decodeURIComponent(unpub[1])
      ).run();

      return json({ ok: true });
    }
  }

  if (env.ASSETS) return env.ASSETS.fetch(req);

  return new Response("Not found", { status: 404 });
}

export default { fetch: handle };
