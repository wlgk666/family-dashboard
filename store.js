// Family data store on Supabase.
// One table `docs(family, col, id, data)`; Row Level Security only lets a request
// see rows whose `family` equals sha256(x-family-key header), so the family password
// never leaves the browser except as that header. Changes are announced to the
// other open devices over a Realtime broadcast channel, which then re-fetch.
(function () {
  async function sha256hex(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
  }
  const newId = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "").slice(0, 20)
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

  async function createFamilyStore(cfg, key, onChange) {
    const sb = window.supabase.createClient(cfg.url, cfg.anonKey, {
      global: { headers: { "x-family-key": key } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const fam = await sha256hex(key);
    const cache = {}; // col -> Map(id -> data)
    const colMap = col => (cache[col] ||= new Map());

    async function fetchRows(col) {
      let q = sb.from("docs").select("col,id,data");
      if (col) q = q.eq("col", col); else q = q.neq("col", "photo"); // photos are big: load them one by one when shown
      const { data, error } = await q.limit(5000);
      if (error) throw error;
      return data;
    }
    async function loadAll() {
      const rows = await fetchRows();
      Object.keys(cache).forEach(k => cache[k].clear());
      rows.forEach(r => colMap(r.col).set(r.id, r.data));
      onChange(null);
      return rows.length;
    }
    async function loadCol(col) {
      const rows = await fetchRows(col);
      colMap(col).clear();
      rows.forEach(r => colMap(col).set(r.id, r.data));
      onChange(col);
    }

    const channel = sb.channel("fam-" + fam.slice(0, 24), { config: { broadcast: { self: false } } });
    channel.on("broadcast", { event: "changed" }, ({ payload }) => {
      if (payload && payload.col) loadCol(payload.col).catch(console.error);
    });
    channel.subscribe();
    const ping = col => channel.send({ type: "broadcast", event: "changed", payload: { col } }).catch(() => {});

    async function write(col, id, data) {
      colMap(col).set(id, data);
      onChange(col);
      const { error } = await sb.from("docs").upsert({ family: fam, col, id, data, updated_at: new Date().toISOString() });
      if (error) { await loadCol(col).catch(() => {}); throw error; }
      ping(col);
    }
    async function remove(col, id) {
      colMap(col).delete(id);
      onChange(col);
      const { error } = await sb.from("docs").delete().eq("col", col).eq("id", id);
      if (error) { await loadCol(col).catch(() => {}); throw error; }
      ping(col);
    }
    function doc(path) {
      const [col, id] = path.split("/");
      return {
        id,
        set: data => write(col, id, data),
        update: patch => {
          const cur = colMap(col).get(id);
          if (!cur) return Promise.reject(new Error("not_found"));
          return write(col, id, { ...cur, ...patch });
        },
        delete: () => remove(col, id),
      };
    }
    function collection(col) {
      return {
        doc: id => doc(col + "/" + (id || newId())),
        add: async data => { const id = newId(); await write(col, id, data); return { id }; },
      };
    }
    const list = col => [...colMap(col)].map(([id, d]) => ({ id, ...d }));
    const photos = new Map();
    function getPhoto(id) {
      if (!photos.has(id)) photos.set(id, (async () => {
        const local = colMap("photo").get(id); if (local) return local.img;
        const { data, error } = await sb.from("docs").select("data").eq("col", "photo").eq("id", id).limit(1);
        if (error || !data.length) { photos.delete(id); return ""; }
        return data[0].data.img;
      })());
      return photos.get(id);
    }
    // photos older than `ms` are deleted by whichever family device opens the app first
    async function cleanupPhotos(ms) {
      const { data, error } = await sb.from("docs").select("id,created:data->createdAt").eq("col", "photo").limit(5000);
      if (error) return 0;
      const old = data.filter(r => Number(r.created || 0) < Date.now() - ms);
      for (const r of old) { await sb.from("docs").delete().eq("col", "photo").eq("id", r.id); photos.delete(r.id); }
      return old.length;
    }
    return { doc, collection, list, loadAll, loadCol, getPhoto, cleanupPhotos, family: fam };
  }
  window.createFamilyStore = createFamilyStore;
})();
