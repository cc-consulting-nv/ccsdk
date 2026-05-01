import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeFileName } from "../dist/utils/s3Key.js";

test("sanitizeFileName strips path separators (traversal)", () => {
  // Slashes/backslashes become `_`; dots are preserved (legal filename char).
  // Removing the separators is sufficient to prevent S3 key path traversal.
  assert.equal(sanitizeFileName("../../../etc/passwd.jpg"), ".._.._.._etc_passwd.jpg");
  assert.equal(sanitizeFileName("..\\..\\boot.ini"), ".._.._boot.ini");
});

test("sanitizeFileName strips null bytes", () => {
  assert.equal(sanitizeFileName("file\x00.jpg"), "file_.jpg");
});

test("sanitizeFileName strips control characters", () => {
  assert.equal(sanitizeFileName("name\r\n.txt"), "name__.txt");
  assert.equal(sanitizeFileName("name\t.txt"), "name_.txt");
});

test("sanitizeFileName strips Unicode RTL override", () => {
  // U+202E (RIGHT-TO-LEFT OVERRIDE) — written as escape so source bytes stay ASCII.
  assert.equal(sanitizeFileName("evil\u202Egpj.exe"), "evil_gpj.exe");
});

test("sanitizeFileName strips quotes, semicolons, and shell metacharacters", () => {
  assert.equal(sanitizeFileName('a"b;c&d.txt'), "a_b_c_d.txt");
  assert.equal(sanitizeFileName("a'b`c$d.txt"), "a_b_c_d.txt");
});

test("sanitizeFileName preserves alnum, dot, and dash", () => {
  assert.equal(sanitizeFileName("photo-2024.10.jpg"), "photo-2024.10.jpg");
  assert.equal(sanitizeFileName("File123.PNG"), "File123.PNG");
});

test("sanitizeFileName replaces spaces and unicode with underscores", () => {
  assert.equal(sanitizeFileName("my photo.jpg"), "my_photo.jpg");
  assert.equal(sanitizeFileName("résumé.pdf"), "r_sum_.pdf");
});

test("sanitizeFileName caps length at 200 characters", () => {
  const long = "a".repeat(500) + ".jpg";
  const result = sanitizeFileName(long);
  assert.equal(result.length, 200);
  assert.equal(result, "a".repeat(200));
});

test("sanitizeFileName handles empty string", () => {
  assert.equal(sanitizeFileName(""), "");
});

test("sanitizeFileName preserves leading dot (caller must guard hidden-file semantics)", () => {
  // The sanitizer keeps `.` since it's a legal filename char.
  // Hidden-file risk is the caller's responsibility (key prefix avoids it in current call sites).
  assert.equal(sanitizeFileName(".htaccess"), ".htaccess");
});
