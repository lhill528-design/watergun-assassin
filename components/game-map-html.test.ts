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
      // two the template itself owns (leaflet.js's tag, and the inline
      // script block), regardless of what the label contains.
      expect(html).not.toMatch(/<img\s/i);
      expect(html.match(/<\/script>/g)?.length).toBe(2);
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
      expect(html.match(/<\/script>/g)?.length).toBe(2);
    });
  });

  it("falls back to a safe default zone label and still escapes it", () => {
    const html = buildMapHtml(null, [], false, [{ latitude: 10, longitude: 20, radiusMeters: 100 }]);
    expect(html).toContain(`bindPopup(${JSON.stringify("<b>⛪ Sanctuary</b><br/>Safe zone — hunters should not enter")})`);
  });
});

describe("escapeHtml", () => {
  it("escapes every HTML metacharacter, not just quotes", () => {
    expect(escapeHtml(`<img src=x onerror="alert('x')">&co`)).toBe(
      "&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;co",
    );
  });
});
