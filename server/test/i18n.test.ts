import assert from "node:assert/strict";
import test from "node:test";
import { isPairingPath, localeForLanguageIdentifier, translator, type Locale } from "../../web/src/i18n";

test("pairing page detection accepts only pair paths with an optional trailing slash", () => {
  assert.equal(isPairingPath("/pair"), true);
  assert.equal(isPairingPath("/pair/"), true);
  assert.equal(isPairingPath("/zh-Hans/pair"), true);
  assert.equal(isPairingPath("/zh-Hans/pair/"), true);
  assert.equal(isPairingPath("/repair"), false);
  assert.equal(isPairingPath("/pair/extra"), false);
});

test("every locale tells the user how to continue after connecting", () => {
  const locales: Locale[] = [
    "en", "zh-Hans", "zh-Hant", "ja", "ko", "de", "fr",
    "es", "es-419", "pt-BR", "pt-PT", "ru", "uk",
  ];
  for (const locale of locales) {
    const t = translator(locale);
    assert.ok(t("connectedTitle").length > 0, locale);
    assert.match(t("connectedDetail"), /iPhone/, locale);
  }
});

test("Latin American Spanish browser locales select es-419 automatically", () => {
  for (const language of ["es-419", "es-MX", "es_AR", "es-US"]) {
    assert.equal(localeForLanguageIdentifier(language), "es-419", language);
  }
  assert.equal(localeForLanguageIdentifier("es-ES"), "es");
  assert.equal(localeForLanguageIdentifier("es"), "es");
});
