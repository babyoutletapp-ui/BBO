const json = (data, status=200) => new Response(JSON.stringify(data), {
  status, headers: {"content-type":"application/json; charset=utf-8","cache-control":"no-store"}
});
const corsHeaders = {"access-control-allow-origin":"*","access-control-allow-methods":"GET,POST,PUT,DELETE,OPTIONS","access-control-allow-headers":"content-type,x-admin-password"};
function safeName(name){ return String(name||"promotion").replace(/[^a-zA-Z0-9._-]/g,"_").slice(0,120); }
function authorized(req, env){ return !!env.ADMIN_PASSWORD && req.headers.get("x-admin-password") === env.ADMIN_PASSWORD; }
async function handle(req, env) {
  const url = new URL(req.url), path = url.pathname;
  if (req.method==="OPTIONS") return new Response(null,{headers:corsHeaders});
  if (path==="/api/health") return json({ok:true,site:env.SITE_NAME||"Baby Outlet"});
  if (path==="/api/promotions" && req.method==="GET") {
    const admin = url.searchParams.get("admin")==="1" && authorized(req,env);
    const q = admin
      ? await env.DB.prepare("SELECT * FROM promotions ORDER BY updated_at DESC").all()
      : await env.DB.prepare("SELECT id,title,description,starts_at,ends_at,status,file_name,file_type FROM promotions WHERE status='published' ORDER BY starts_at DESC").all();
    return json(q.results||[]);
  }
  if (path.startsWith("/api/file/") && req.method==="GET") {
    const id=decodeURIComponent(path.slice("/api/file/".length));
    const row=await env.DB.prepare("SELECT file_key,file_name,file_type,status FROM promotions WHERE id=?").bind(id).first();
    if(!row || !row.file_key || row.status!=="published") return new Response("Not found",{status:404});
    const obj=await env.FILES.get(row.file_key);
    if(!obj) return new Response("File not found",{status:404});
    return new Response(obj.body,{headers:{
      "content-type":row.file_type||"application/octet-stream",
      "content-disposition":`inline; filename="${safeName(row.file_name)}"`,
      "cache-control":"public, max-age=60"
    }});
  }
  if (path==="/api/admin/login" && req.method==="POST") {
    const body=await req.json();
    return body.password===env.ADMIN_PASSWORD && !!env.ADMIN_PASSWORD ? json({ok:true}) : json({error:"Incorrect password"},401);
  }
  if (path.startsWith("/api/admin/")) {
    if(!authorized(req,env)) return json({error:"Unauthorized. Please sign in again."},401);
    if(path==="/api/admin/promotions" && req.method==="POST") {
      const form=await req.formData();
      const id=crypto.randomUUID(), title=String(form.get("title")||"").trim();
      const starts=String(form.get("starts_at")||""), ends=String(form.get("ends_at")||"");
      const file=form.get("file");
      if(!title||!starts||!ends||ends<starts||!(file instanceof File)||!file.size) return json({error:"Enter a title, valid dates and upload a file."},400);
      if(file.size>15*1024*1024) return json({error:"Maximum file size is 15 MB."},400);
      const allowed=["image/jpeg","image/png","application/pdf"];
      if(!allowed.includes(file.type)) return json({error:"Only JPG, PNG and PDF files are allowed."},400);
      const key=`promotions/${id}/${safeName(file.name)}`;
      await env.FILES.put(key,file.stream(),{httpMetadata:{contentType:file.type}});
      const now=new Date().toISOString();
      await env.DB.prepare("INSERT INTO promotions (id,title,description,starts_at,ends_at,status,file_key,file_name,file_type,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
        .bind(id,title,String(form.get("description")||""),starts,ends,"draft",key,file.name,file.type,now,now).run();
      return json({ok:true,id});
    }
    const match=path.match(/^\/api\/admin\/promotions\/([^/]+)$/);
    if(match) {
      const id=decodeURIComponent(match[1]);
      if(req.method==="PUT") {
        const form=await req.formData();
        const title=String(form.get("title")||"").trim(), starts=String(form.get("starts_at")||""), ends=String(form.get("ends_at")||"");
        if(!title||!starts||!ends||ends<starts) return json({error:"Check the title and dates."},400);
        const old=await env.DB.prepare("SELECT * FROM promotions WHERE id=?").bind(id).first();
        if(!old)return json({error:"Promotion not found"},404);
        let key=old.file_key, name=old.file_name, type=old.file_type;
        const file=form.get("file");
        if(file instanceof File && file.size){
          if(file.size>15*1024*1024)return json({error:"Maximum file size is 15 MB."},400);
          if(!["image/jpeg","image/png","application/pdf"].includes(file.type))return json({error:"Only JPG, PNG and PDF files are allowed."},400);
          const newKey=`promotions/${id}/${crypto.randomUUID()}-${safeName(file.name)}`;
          await env.FILES.put(newKey,file.stream(),{httpMetadata:{contentType:file.type}});
          if(key) await env.FILES.delete(key);
          key=newKey;name=file.name;type=file.type;
        }
        await env.DB.prepare("UPDATE promotions SET title=?,description=?,starts_at=?,ends_at=?,file_key=?,file_name=?,file_type=?,updated_at=? WHERE id=?")
          .bind(title,String(form.get("description")||""),starts,ends,key,name,type,new Date().toISOString(),id).run();
        return json({ok:true});
      }
      if(req.method==="DELETE"){
        const old=await env.DB.prepare("SELECT file_key FROM promotions WHERE id=?").bind(id).first();
        if(old?.file_key)await env.FILES.delete(old.file_key);
        await env.DB.prepare("DELETE FROM promotions WHERE id=?").bind(id).run();
        return json({ok:true});
      }
    }
    const pub=path.match(/^\/api\/admin\/promotions\/([^/]+)\/publish$/);
    if(pub&&req.method==="POST"){
      await env.DB.prepare("UPDATE promotions SET status='published',updated_at=? WHERE id=?").bind(new Date().toISOString(),decodeURIComponent(pub[1])).run();
      return json({ok:true});
    }
    const unpub=path.match(/^\/api\/admin\/promotions\/([^/]+)\/unpublish$/);
    if(unpub&&req.method==="POST"){
      await env.DB.prepare("UPDATE promotions SET status='draft',updated_at=? WHERE id=?").bind(new Date().toISOString(),decodeURIComponent(unpub[1])).run();
      return json({ok:true});
    }
  }
  if(env.ASSETS) return env.ASSETS.fetch(req);
  return new Response("Not found",{status:404});
}
export default {fetch:handle};
