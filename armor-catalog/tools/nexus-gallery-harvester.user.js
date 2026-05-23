// ==UserScript==
// @name         Bordello Armor Catalog Nexus Gallery Harvester
// @namespace    https://www.themoddingbordello.com/
// @version      1.0.1
// @description  Harvest Nexus thumbgallery image candidates for the Bordello armor catalog from an authenticated browser session.
// @match        http://127.0.0.1:4174/
// @match        http://127.0.0.1:4174/*
// @match        http://localhost:4174/
// @match        http://localhost:4174/*
// @match        http://127.0.0.1:*/*
// @match        http://localhost:*/*
// @grant        GM_xmlhttpRequest
// @connect      www.nexusmods.com
// @connect      nexusmods.com
// @run-at       document-idle
// @noframes
// @updateURL    http://127.0.0.1:4174/tools/nexus-gallery-harvester.user.js
// @downloadURL  http://127.0.0.1:4174/tools/nexus-gallery-harvester.user.js
// ==/UserScript==

(function () {
  "use strict";

  console.info("[Bordello Armor Catalog] Nexus gallery harvester loaded.");
  if (document.getElementById("bordello-gallery-harvester")) return;

  const apiAvailable = typeof GM_xmlhttpRequest === "function";
  const status = document.createElement("div");
  status.textContent = apiAvailable ? "Gallery harvester loaded" : "Gallery harvester loaded, but Tampermonkey API is unavailable";
  status.style.position = "fixed";
  status.style.right = "16px";
  status.style.bottom = "64px";
  status.style.zIndex = "99999";
  status.style.padding = "7px 10px";
  status.style.border = "1px solid #473934";
  status.style.borderRadius = "8px";
  status.style.background = "#1d1917";
  status.style.color = apiAvailable ? "#7db88f" : "#d87972";
  status.style.font = "600 12px system-ui, sans-serif";
  document.body.appendChild(status);

  const button = document.createElement("button");
  button.id = "bordello-gallery-harvester";
  button.type = "button";
  button.textContent = apiAvailable ? "Harvest Nexus galleries" : "Tampermonkey API missing";
  button.disabled = !apiAvailable;
  button.style.position = "fixed";
  button.style.right = "16px";
  button.style.bottom = "16px";
  button.style.zIndex = "99999";
  button.style.padding = "10px 14px";
  button.style.border = "1px solid #d7a94b";
  button.style.borderRadius = "8px";
  button.style.background = "#a9342c";
  button.style.color = "#fff";
  button.style.font = "700 14px system-ui, sans-serif";
  button.style.cursor = apiAvailable ? "pointer" : "not-allowed";
  button.style.opacity = apiAvailable ? "1" : "0.7";
  document.body.appendChild(button);

  button.addEventListener("click", async () => {
    const entries = await getCatalogEntries();
    const rows = [["catalog_id", "display_name", "nexus_mod_id", "candidate_rank", "image_url", "source_url"]];
    button.disabled = true;
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      button.textContent = `Harvesting ${index + 1}/${entries.length}`;
      const images = await fetchGallery(entry.nexusUrl);
      images.forEach((imageUrl, imageIndex) => {
        rows.push([
          entry.catalogId,
          entry.displayName,
          entry.nexusModId,
          String(imageIndex + 1),
          imageUrl,
          entry.nexusUrl
        ]);
      });
      await sleep(350);
    }
    downloadCsv(rows);
    button.textContent = "Harvest complete";
    button.disabled = false;
  });

  async function getCatalogEntries() {
    const response = await fetch("/armor-catalog.json");
    const payload = await response.json();
    return payload.entries.filter((entry) => entry.nexusUrl);
  }

  function fetchGallery(url) {
    return new Promise((resolve) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        anonymous: false,
        onload: (response) => {
          const html = response.responseText || "";
          const match = html.match(/<ul class="thumbgallery gallery clearfix"[^>]*>([\s\S]*?)<\/ul>/);
          if (!match) {
            resolve([]);
            return;
          }
          const images = [];
          const regex = /<img\s+[^>]*src="([^"]+)"[^>]*>/g;
          let imageMatch;
          while ((imageMatch = regex.exec(match[1])) !== null) {
            images.push(toLargeStaticUrl(imageMatch[1]));
          }
          resolve([...new Set(images)]);
        },
        onerror: () => resolve([])
      });
    });
  }

  function toLargeStaticUrl(url) {
    return url
      .replace("https://images.nexusmods.com/mod-images/", "https://staticdelivery.nexusmods.com/mods/")
      .replace("/tb/med/", "/images/")
      .replace("/t/large/", "/images/");
  }

  function downloadCsv(rows) {
    const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
    const blob = new Blob([csv + "\n"], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "nexus-gallery-candidates.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function csvEscape(value) {
    const text = String(value || "");
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
})();
