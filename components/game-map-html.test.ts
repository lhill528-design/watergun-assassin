import { describe, expect, it } from "vitest";
import { buildMapHtml, escapeHtml } from "./game-map-html";

// Player display names and Sanctuary zone labels are player-supplied and
// end up inside the native WebView's popup HTML. Each of these targets a
// distinct way that could go wrong: breaking into markup, closing the
// surrounding <script> block early, breaking out of a hand-rolled JS
// string literal, or -- with a raw newline/backslash -- producing invalid
// JavaScript that would crash the whole map.
const PAYLOADS: Array<[name: string, payload: string]> = [
  ["HTML tag injection", "<img src=x onerror=alert(1)>"],
  ["script tag breakout", "</script><script>alert(document.domain)</script>"],
  ["single and double quotes", `it's a "trap"`],
  ["backslashes and newlines", "line one\\nline two\nliteral\\backslash"],
];

describe("game-map-html: buildMapHtml popup escaping", () => {
  describe.each(PAYLOADS)("%s", (_name, payload) => {
    it("escapes a player-pin label into an inert, safely-embedded popup", () => {
      const html = buildMapHtml(
        null,
        [{ id: 1, label: payload, latitude: 10, longitude: 20, type: "player" }],
        false,
        [],
      );
      const expectedPopupHtml = `<b>${escapeHtml(payload)}</b>`;

      // The popup argument is exactly JSON.stringify(alreadyEscapedHtml) --
      // i.e. safely embedded as a JS string literal, not hand-escaped.
      expect(html).toContain(`bindPopup(${JSON.stringify(expectedPopupHtml)})`);

      // No unescaped markup or script-closing sequence from the payload
      // survives in the output; the only <script> closers present are the
      // three the template itself owns (the error-reporter block,
      // leaflet.js's tag, and the main init script), regardless of what
      // the label contains.
      expect(html).not.toMatch(/<img\s/i);
      expect(html.match(/<\/script>/g)?.length).toBe(3);
    });

    it("escapes a Sanctuary zone label into an inert, safely-embedded popup", () => {
      const html = buildMapHtml(
        null,
        [],
        false,
        [{ latitude: 10, longitude: 20, radiusMeters: 100, label: payload }],
      );
      const expectedPopupHtml = `<b>⛪ ${escapeHtml(payload)}</b><br/>Safe zone — hunters should not enter`;

      expect(html).toContain(`bindPopup(${JSON.stringify(expectedPopupHtml)})`);
      expect(html).not.toMatch(/<img\s/i);
      expect(html.match(/<\/script>/g)?.length).toBe(3);
    });
  });

  it("falls back to a safe default zone label and still escapes it", () => {
    const html = buildMapHtml(null, [], false, [{ latitude: 10, longitude: 20, radiusMeters: 100 }]);
    expect(html).toContain(`bindPopup(${JSON.stringify("<b>⛪ Sanctuary</b><br/>Safe zone — hunters should not enter")})`);
  });
});

describe("game-map-html: buildMapHtml centering", () => {
  it("filters out pins with non-finite coordinates before drawing or fitting bounds", () => {
    const html = buildMapHtml(
      null,
      [
        { id: 1, label: "Valid", latitude: 10, longitude: 20, type: "player" },
        { id: 2, label: "NaN lat", latitude: NaN, longitude: 20, type: "player" },
        { id: 3, label: "Infinite lon", latitude: 10, longitude: Infinity, type: "player" },
      ],
      false,
      [],
    );
    expect(html).toContain("L.marker([10, 20]");
    expect(html).not.toContain("NaN lat");
    expect(html).not.toContain("Infinite lon");
  });

  it("fits the map to valid pin bounds when there is no GPS center and no focus", () => {
    const html = buildMapHtml(
      null,
      [
        { id: 1, label: "A", latitude: 10, longitude: 20, type: "player" },
        { id: 2, label: "B", latitude: 30, longitude: 40, type: "player" },
      ],
      false,
      [],
    );
    expect(html).toContain("map.fitBounds(L.latLngBounds([[10,20],[30,40]])");
  });

  it("does not fit bounds when a GPS center is available, even with pins present", () => {
    const html = buildMapHtml(
      { latitude: 1, longitude: 2 },
      [{ id: 1, label: "A", latitude: 10, longitude: 20, type: "player" }],
      false,
      [],
    );
    expect(html).not.toContain("fitBounds");
    expect(html).toContain("setView([1,2],14)");
  });

  it("focusLocation takes priority over the GPS center for the initial view", () => {
    const html = buildMapHtml(
      { latitude: 1, longitude: 2 },
      [],
      false,
      [],
      { latitude: 9, longitude: 8 },
    );
    expect(html).toContain("setView([9,8],15)");
    // The "You" marker still reflects the real GPS center, not the focus.
    expect(html).toContain("L.marker([1, 2]");
  });

  it("ignores a non-finite focusLocation and falls back to the GPS center", () => {
    const html = buildMapHtml({ latitude: 1, longitude: 2 }, [], false, [], { latitude: NaN, longitude: 8 });
    expect(html).toContain("setView([1,2],14)");
  });
});

describe("game-map-html: buildMapHtml Leaflet load-failure reporting", () => {
  it("defines an error reporter before Leaflet loads, and wires window.onerror to it", () => {
    const html = buildMapHtml(null, [], false, []);
    const headStart = html.indexOf("<head>");
    const reporterIndex = html.indexOf("window.__reportMapError=function");
    const leafletScriptIndex = html.indexOf('src="https://unpkg.com/leaflet');

    expect(reporterIndex).toBeGreaterThan(headStart);
    expect(reporterIndex).toBeLessThan(leafletScriptIndex); // reporter must exist before Leaflet's tags can reference it
    expect(html).toContain("window.onerror=function(){window.__reportMapError('window-onerror')");
    expect(html).toContain("window.ReactNativeWebView.postMessage(JSON.stringify({type:'map_error'");
  });

  it("wires an onerror attribute on both the Leaflet script and stylesheet tags", () => {
    const html = buildMapHtml(null, [], false, []);
    expect(html).toContain(`<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" onerror="window.__reportMapError('leaflet-css')"/>`);
    expect(html).toContain(`<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" onerror="window.__reportMapError('leaflet-js')">`);
  });

  it("wraps the main map-init script in try/catch, reporting 'map-init' on any init failure", () => {
    const html = buildMapHtml(null, [], false, []);
    expect(html).toMatch(/<script>try\{var map=L\.map/);
    expect(html).toContain("}catch(e){window.__reportMapError('map-init');}");
  });
});

describe("escapeHtml", () => {
  it("escapes every HTML metacharacter, not just quotes", () => {
    expect(escapeHtml(`<img src=x onerror="alert('x')">&co`)).toBe(
      "&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;co",
    );
  });
});
