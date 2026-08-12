import test from "node:test";
import assert from "node:assert/strict";

import {
  detectMediaType,
  isAllowedMediaFile,
  MEDIA_MAX_BYTES,
  resolveMimeType,
  validateMediaFile,
} from "../dist/media.js";

// Node's File carries name/type/size, which is all the validator reads. Size is
// faked via the content length so large-file cases don't allocate real bytes.
const makeFile = (name, type, size = 1024) => {
  const file = new File([""], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
};

test("resolveMimeType: prefers the browser-reported type", () => {
  assert.equal(resolveMimeType(makeFile("clip.mov", "video/quicktime")), "video/quicktime");
});

test("resolveMimeType: falls back to the extension when type is empty", () => {
  // The iOS camera-roll / share-sheet case that broke video upload.
  assert.equal(resolveMimeType(makeFile("IMG_0001.MOV", "")), "video/quicktime");
  // .m4v resolves to the registered video/mp4, not the unregistered x- form.
  assert.equal(resolveMimeType(makeFile("clip.m4v", "")), "video/mp4");
  assert.equal(resolveMimeType(makeFile("photo.HEIC", "")), "image/heic");
});

test("resolveMimeType: a reported x- type is passed through unchanged", () => {
  // Only the extension fallback normalises; a browser-reported type is trusted
  // as-is, so this still reaches R2 as the Content-Type the browser chose.
  assert.equal(resolveMimeType(makeFile("clip.m4v", "video/x-m4v")), "video/x-m4v");
});

test("resolveMimeType: empty string when neither source yields a type", () => {
  assert.equal(resolveMimeType(makeFile("mystery", "")), "");
  assert.equal(resolveMimeType(makeFile("archive.xyz", "")), "");
});

test("detectMediaType: infers from an extension-derived type", () => {
  assert.equal(detectMediaType(makeFile("IMG_0001.MOV", "")), "video");
  assert.equal(detectMediaType(makeFile("song.mp3", "")), "audio");
  assert.equal(detectMediaType(makeFile("doc.pdf", "")), "file");
  assert.equal(detectMediaType(makeFile("mystery", "")), null);
});

test("validateMediaFile: accepts iOS video types the old exact-match list rejected", () => {
  // Both were rejected by the old exact-match allowlist (issue #157). x-m4v is
  // unregistered but still in circulation, so a browser reporting it must pass.
  assert.equal(validateMediaFile(makeFile("clip.m4v", "video/x-m4v"), "video"), null);
  assert.equal(validateMediaFile(makeFile("IMG_0001.MOV", ""), "video"), null);
  assert.equal(validateMediaFile(makeFile("clip.3gp", "video/3gpp"), "video"), null);
});

test("validateMediaFile: still rejects a genuine type mismatch", () => {
  assert.equal(
    validateMediaFile(makeFile("photo.png", "image/png"), "video"),
    "Please select a valid video file"
  );
});

test("validateMediaFile: unknown type is unsupported, not a silent pass", () => {
  assert.equal(validateMediaFile(makeFile("mystery", "")), "Unsupported file type");
});

test("validateMediaFile: enforces the per-type size cap", () => {
  const tooBig = makeFile("big.mp4", "video/mp4", MEDIA_MAX_BYTES.video + 1);
  assert.equal(validateMediaFile(tooBig, "video"), "Video exceeds the 500MB upload limit");
});

test("validateMediaFile: a positive maxBytes override replaces the default", () => {
  const file = makeFile("big.mp4", "video/mp4", 600 * 1024 * 1024);
  assert.equal(validateMediaFile(file, "video", 2 * 1024 * 1024 * 1024), null);
  assert.equal(
    validateMediaFile(file, "video", 100 * 1024 * 1024),
    "Video exceeds the 100MB upload limit"
  );
});

test("validateMediaFile: a zero or negative override falls back to the default", () => {
  const file = makeFile("big.mp4", "video/mp4", MEDIA_MAX_BYTES.video + 1);
  assert.equal(validateMediaFile(file, "video", 0), "Video exceeds the 500MB upload limit");
  assert.equal(validateMediaFile(file, "video", -1), "Video exceeds the 500MB upload limit");
});

test("isAllowedMediaFile: boolean mirror of validateMediaFile", () => {
  assert.equal(isAllowedMediaFile(makeFile("clip.m4v", "video/x-m4v"), "video"), true);
  assert.equal(isAllowedMediaFile(makeFile("photo.png", "image/png"), "video"), false);
});
