(() => {
  const root = document.getElementById("moments-app");
  if (!root) return;

  const actionUrl = root.dataset.actionUrl;
  const token = root.dataset.token;
  const textEl = document.getElementById("moment-text");
  const imageUrlEl = document.getElementById("moment-image-url");
  const addImageUrlBtn = document.getElementById("moment-add-image-url");
  const previewsEl = document.getElementById("moment-previews");
  const hintEl = document.getElementById("moment-upload-hint");
  const topicsEl = document.getElementById("moment-topics");
  const allowEl = document.getElementById("moment-allow-comment");
  const moreEl = document.getElementById("moment-more");
  const toggleMore = document.getElementById("moment-toggle-more");
  const draftBtn = document.getElementById("moment-draft");
  const publishBtn = document.getElementById("moment-publish");
  const rebuildBtn = document.getElementById("moment-rebuild");
  const statusEl = document.getElementById("moment-status");
  const listEl = document.getElementById("moment-list");
  const searchEl = document.getElementById("moment-search");
  const searchBtn = document.getElementById("moment-search-btn");
  const loadMoreBtn = document.getElementById("moment-load-more");

  /** @type {{aid?: number, src: string, width?: number, height?: number, alt?: string}[]} */
  let images = [];
  let editingCid = 0;
  let saving = false;
  let clientToken = "";
  let listNext = null;
  let listQuery = "";
  let lastRebuildCid = 0;

  const setStatus = (message, kind = "") => {
    statusEl.textContent = message || "";
    if (kind) statusEl.dataset.kind = kind;
    else delete statusEl.dataset.kind;
  };

  const showRebuild = (cid, show) => {
    lastRebuildCid = cid || 0;
    rebuildBtn.hidden = !show;
  };

  const formBody = (fields) => {
    const body = new FormData();
    body.set("_", token);
    for (const [key, value] of Object.entries(fields)) {
      if (value == null) continue;
      body.set(key, value);
    }
    return body;
  };

  const postJson = async (fields) => {
    const res = await fetch(actionUrl, {
      method: "POST",
      body: formBody(fields),
      credentials: "same-origin",
    });
    const data = await res.json().catch(() => ({ ok: false, error: "json" }));
    if (!res.ok || !data.ok) {
      const err = new Error(data.error || `http-${res.status}`);
      err.code = data.error;
      throw err;
    }
    return data;
  };

  const renderPreviews = () => {
    previewsEl.hidden = images.length === 0;
    previewsEl.innerHTML = "";
    images.forEach((image, index) => {
      const li = document.createElement("li");
      const img = document.createElement("img");
      img.src = image.src;
      img.alt = image.alt || "";
      const tools = document.createElement("div");
      tools.className = "moments-preview-tools";
      const up = document.createElement("button");
      up.type = "button";
      up.setAttribute("aria-label", "前移");
      up.textContent = "↑";
      up.disabled = index === 0;
      up.addEventListener("click", () => {
        if (index === 0) return;
        const [item] = images.splice(index, 1);
        images.splice(index - 1, 0, item);
        renderPreviews();
      });
      const down = document.createElement("button");
      down.type = "button";
      down.setAttribute("aria-label", "后移");
      down.textContent = "↓";
      down.disabled = index === images.length - 1;
      down.addEventListener("click", () => {
        if (index >= images.length - 1) return;
        const [item] = images.splice(index, 1);
        images.splice(index + 1, 0, item);
        renderPreviews();
      });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.setAttribute("aria-label", "移除图片");
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        images.splice(index, 1);
        renderPreviews();
      });
      tools.append(up, down, remove);
      li.append(img, tools);
      previewsEl.append(li);
    });
  };

  const parseTopics = () =>
    topicsEl.value
      .split(/[,，#\s]+/)
      .map((t) => t.trim())
      .filter(Boolean);

  const isAllowedImageSrc = (src) => {
    if (!src) return false;
    if (src.startsWith("/")) return !src.startsWith("//");
    try {
      const url = new URL(src);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  };

  const probeImage = (src) =>
    new Promise((resolve) => {
      const img = new Image();
      img.onload = () =>
        resolve({
          src,
          width: img.naturalWidth || undefined,
          height: img.naturalHeight || undefined,
        });
      img.onerror = () => resolve({ src });
      img.src = src;
    });

  const addImageUrl = async ({ silentEmpty = false } = {}) => {
    const src = (imageUrlEl.value || "").trim();
    if (!src) {
      if (!silentEmpty) {
        setStatus("请粘贴图片链接", "error");
        imageUrlEl.focus();
      }
      return false;
    }
    if (!isAllowedImageSrc(src)) {
      setStatus("仅支持 http(s) 或站内路径", "error");
      return false;
    }
    if (images.some((image) => image.src === src)) {
      imageUrlEl.value = "";
      return true;
    }
    if (images.length >= 9) {
      setStatus("每条最多 9 张图片", "error");
      return false;
    }
    hintEl.hidden = false;
    hintEl.textContent = "正在检查图片链接…";
    const image = await probeImage(src);
    images.push(image);
    renderPreviews();
    imageUrlEl.value = "";
    hintEl.hidden = true;
    setStatus("图片链接已添加", "ok");
    return true;
  };

  const resetComposer = () => {
    editingCid = 0;
    clientToken = "";
    textEl.value = "";
    topicsEl.value = "";
    allowEl.checked = true;
    imageUrlEl.value = "";
    images = [];
    renderPreviews();
  };

  const save = async (status) => {
    if (saving) {
      setStatus("正在保存…", "error");
      return;
    }
    // If the URL box still has text, treat it as an added image (avoid publish-without-click).
    if ((imageUrlEl.value || "").trim()) {
      const ok = await addImageUrl();
      if (!ok) return;
    }
    const text = textEl.value.trim();
    if (!text && images.length === 0) {
      setStatus("请输入文字或添加图片链接", "error");
      return;
    }
    if (!clientToken) {
      clientToken =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `m-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }
    saving = true;
    draftBtn.disabled = true;
    publishBtn.disabled = true;
    setStatus(status === "draft" ? "正在保存草稿…" : "正在发布…");
    try {
      const data = await postJson({
        do: "save",
        cid: String(editingCid || ""),
        text,
        status,
        allowComment: allowEl.checked ? "1" : "0",
        images: JSON.stringify(images),
        topics: JSON.stringify(parseTopics()),
        clientToken,
      });
      setStatus(data.message || "已保存", data.rebuildQueued === false && (status === "publish" || data.withdrawn) ? "error" : "ok");
      showRebuild(data.cid, data.rebuildQueued === false && (status === "publish" || data.withdrawn));
      if (status === "publish" && data.rebuildQueued) {
        resetComposer();
      } else {
        editingCid = data.cid || editingCid;
      }
      await loadList({ reset: true });
    } catch (error) {
      setStatus(`保存失败：${error.code || error.message}（内容仍保留在输入框）`, "error");
      showRebuild(editingCid, true);
    } finally {
      saving = false;
      draftBtn.disabled = false;
      publishBtn.disabled = false;
    }
  };

  const loadIntoComposer = (item) => {
    editingCid = item.cid;
    clientToken = "";
    textEl.value = item.text || "";
    topicsEl.value = (item.topics || []).join(", ");
    allowEl.checked = item.allowComment !== false;
    images = Array.isArray(item.images) ? [...item.images] : [];
    renderPreviews();
    moreEl.hidden = false;
    toggleMore.setAttribute("aria-expanded", "true");
    showRebuild(0, false);
    setStatus(`正在编辑 #${item.cid}`, "");
    textEl.focus();
  };

  const appendItems = (items, { append }) => {
    if (!append) listEl.innerHTML = "";
    if (!items.length && !append) {
      listEl.innerHTML = "<li class=\"meta\">还没有闲话。</li>";
      return;
    }
    for (const item of items) {
      const li = document.createElement("li");
      const preview = (item.text || "").trim() || "（图片动态）";
      const title = document.createElement("div");
      title.textContent = preview.slice(0, 80);
      const meta = document.createElement("div");
      meta.className = "meta";
      const when = new Date(item.created * 1000).toLocaleString("zh-CN", { hour12: false });
      meta.textContent = `#${item.cid} · ${item.status === "draft" ? "草稿" : "公开"} · ${when}`;
      const actions = document.createElement("div");
      actions.className = "row-actions";
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "linkish";
      edit.textContent = "编辑";
      edit.addEventListener("click", () => loadIntoComposer(item));
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "linkish";
      copy.textContent = "复制链接";
      copy.addEventListener("click", async () => {
        try {
          const url = new URL(item.publicPath, window.location.origin).href;
          await navigator.clipboard.writeText(url);
          copy.textContent = "已复制";
          setTimeout(() => {
            copy.textContent = "复制链接";
          }, 1200);
        } catch {
          copy.textContent = "复制失败";
        }
      });
      const del = document.createElement("button");
      del.type = "button";
      del.className = "linkish";
      del.textContent = "删除";
      del.addEventListener("click", async () => {
        if (!window.confirm(`确认删除闲话 #${item.cid}？此操作不可撤销。`)) return;
        try {
          const data = await postJson({ do: "delete", cid: String(item.cid), confirm: "delete" });
          setStatus(data.message || "已删除", data.rebuildQueued ? "ok" : "error");
          showRebuild(item.cid, !data.rebuildQueued);
          if (editingCid === item.cid) resetComposer();
          await loadList({ reset: true });
        } catch (error) {
          setStatus(`删除失败：${error.message}`, "error");
        }
      });
      actions.append(edit, copy, del);
      if (item.status === "publish") {
        const link = document.createElement("a");
        link.href = item.publicPath;
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent = "前台地址";
        actions.append(link);
      }
      li.append(title, meta, actions);
      listEl.append(li);
    }
  };

  const loadList = async ({ reset = false, append = false } = {}) => {
    try {
      if (reset) {
        listNext = null;
        append = false;
      }
      const fields = { do: "list", q: listQuery };
      if (append && listNext) {
        fields.beforeCreated = String(listNext.beforeCreated);
        fields.beforeCid = String(listNext.beforeCid);
      }
      const data = await postJson(fields);
      listNext = data.next || null;
      loadMoreBtn.hidden = !listNext;
      appendItems(data.items || [], { append });
    } catch (error) {
      if (!append) listEl.innerHTML = `<li class="meta">列表加载失败：${error.message}</li>`;
      loadMoreBtn.hidden = true;
    }
  };

  toggleMore.addEventListener("click", () => {
    const open = moreEl.hasAttribute("hidden");
    moreEl.hidden = !open;
    toggleMore.setAttribute("aria-expanded", open ? "true" : "false");
  });
  addImageUrlBtn.addEventListener("click", () => {
    addImageUrl();
  });
  imageUrlEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addImageUrl();
    }
  });
  draftBtn.addEventListener("click", () => save("draft"));
  publishBtn.addEventListener("click", () => save("publish"));
  rebuildBtn.addEventListener("click", async () => {
    try {
      const data = await postJson({
        do: "rebuild",
        cid: String(lastRebuildCid || editingCid || ""),
      });
      setStatus(data.message || "已重试", data.rebuildQueued ? "ok" : "error");
      showRebuild(lastRebuildCid, !data.rebuildQueued);
    } catch (error) {
      setStatus(`重试失败：${error.message}`, "error");
    }
  });
  searchBtn.addEventListener("click", () => {
    listQuery = searchEl.value.trim();
    loadList({ reset: true });
  });
  searchEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      listQuery = searchEl.value.trim();
      loadList({ reset: true });
    }
  });
  loadMoreBtn.addEventListener("click", () => loadList({ append: true }));

  loadList({ reset: true });
})();
